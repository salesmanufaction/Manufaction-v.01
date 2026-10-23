"""
Manufaction v0.1 — virtual factory.

Plays the role of a future Manufaction Edge device: publishes telemetry, status and
events for three machines over MQTT, and obeys commands sent back from the cloud.

Topics (all under mf/v1/site/{SITE}/asset/{ASSET}/...):
  telemetry  every TELEMETRY_SECONDS   {"timestamp", "asset_id", "signals": {...}, "units": {...}}
  status     on change + every 15 s               {"timestamp", "asset_id", "status", "reason_code"?}
  event      on occurrence             {"timestamp", "asset_id", "event_type", ...}
  command    subscribed                {"command": "start_order" | "complete_order" | "inject_fault", ...}

State machine per asset:   IDLE --start_order--> RUNNING --fault--> FAULTED --repair--> RUNNING
                           RUNNING --complete_order--> IDLE
"""

import json
import logging
import os
import random
import signal
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

SITE = os.getenv("SIM_SITE", "demo")
BROKER = os.getenv("MQTT_HOST", "mqtt")
PORT = int(os.getenv("MQTT_PORT", "1883"))
USER = os.getenv("MQTT_EDGE_USER", "edge")
PASSWORD = os.getenv("MQTT_EDGE_PASSWORD", "")
TELEMETRY_SECONDS = float(os.getenv("SIM_TELEMETRY_SECONDS", "5"))
SPEED = float(os.getenv("SIM_SPEED", "1.0"))          # >1 runs the factory faster
FAULT_RATE = float(os.getenv("SIM_FAULT_RATE", "0.02"))  # probability of a fault per cycle
SCRAP_RATE = float(os.getenv("SIM_SCRAP_RATE", "0.03"))  # probability a part is scrap

# Demo mode: faults happen on a predictable schedule instead of at random, so a recorded
# demo always has a downtime moment. Random faults are switched off while it is on.
DEMO_MODE = os.getenv("SIM_DEMO_MODE", "false").strip().lower() in ("1", "true", "yes", "on")
DEMO_FAULT_EVERY = float(os.getenv("SIM_DEMO_FAULT_EVERY", "75"))     # seconds between scheduled faults
DEMO_FAULT_SECONDS = float(os.getenv("SIM_DEMO_FAULT_SECONDS", "30")) # how long each one lasts (real seconds)
if DEMO_MODE:
    FAULT_RATE = 0.0

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("simulator")

FAULTS = {
    "press":    [("JAM", "Material jam in die"), ("OVERTEMP", "Hydraulic oil over temperature"),
                 ("MATERIAL_SHORT", "Coil material shortage")],
    "cnc":      [("TOOL_BREAK", "Tool breakage detected"), ("SPINDLE_LOAD", "Spindle overload"),
                 ("DOOR_OPEN", "Safety door opened")],
    "assembly": [("PART_MISSING", "Component feeder empty"), ("TORQUE_FAIL", "Torque out of tolerance"),
                 ("OPERATOR_ABSENT", "Operator not at station")],
}
DEFECTS = {
    "press": ["BURR", "SPLIT", "DIMENSION"],
    "cnc": ["SURFACE_FINISH", "DIMENSION", "CHATTER"],
    "assembly": ["MISSING_FASTENER", "TORQUE", "LABEL"],
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass
class Machine:
    asset_id: str
    kind: str
    cycle_seconds: float
    status: str = "idle"
    order_number: str | None = None
    part_number: str | None = None
    cycle_count: int = 0
    next_cycle_at: float = 0.0
    fault_until: float = 0.0
    fault: tuple | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)

    def signals(self) -> tuple[dict, dict]:
        running = self.status == "running"
        if self.kind == "press":
            s = {"temperature": round(185 + random.uniform(-5, 5) + (8 if self.fault and self.fault[0] == "OVERTEMP" else 0), 1),
                 "pressure": round((1800 if running else 300) + random.uniform(-100, 100)),
                 "cycle_count": self.cycle_count}
            u = {"temperature": "degF", "pressure": "psi", "cycle_count": "count"}
        elif self.kind == "cnc":
            s = {"spindle_rpm": round(random.uniform(3800, 4500)) if running else 0,
                 "spindle_load_pct": round(random.uniform(35, 70) if running else 0, 1),
                 "coolant_temp": round(75 + random.uniform(-10, 10), 1),
                 "cycle_count": self.cycle_count}
            u = {"spindle_rpm": "rpm", "spindle_load_pct": "%", "coolant_temp": "degF", "cycle_count": "count"}
        else:
            s = {"operator_efficiency_pct": round(random.uniform(78, 104) if running else 0, 1),
                 "station_temp": round(70 + random.uniform(-2, 2), 1),
                 "cycle_count": self.cycle_count}
            u = {"operator_efficiency_pct": "%", "station_temp": "degF", "cycle_count": "count"}
        return s, u


MACHINES = {
    m.asset_id: m for m in [
        Machine("PRESS-001", "press", 8.0),
        Machine("CNC-001", "cnc", 20.0),
        Machine("ASSEMBLY-001", "assembly", 15.0),
    ]
}


class Factory:
    def __init__(self) -> None:
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"mf-sim-{SITE}",
                                  clean_session=True)
        self.client.username_pw_set(USER, PASSWORD)
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_disconnect = lambda *a: log.warning("disconnected from broker")
        self.stop = threading.Event()
        self.demo_turn = 0
        self.next_demo_fault = time.monotonic() + max(DEMO_FAULT_EVERY, 20.0)  # first one after start-up

    # ------------------------------------------------------------------ mqtt
    def topic(self, asset_id: str, kind: str) -> str:
        return f"mf/v1/site/{SITE}/asset/{asset_id}/{kind}"

    def publish(self, m: Machine, kind: str, body: dict, qos: int = 1) -> None:
        payload = {"timestamp": now_iso(), "asset_id": m.asset_id, **body}
        self.client.publish(self.topic(m.asset_id, kind), json.dumps(payload), qos=qos)

    def on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            log.error("broker refused connection: %s", reason_code)
            return
        log.info("connected to %s:%s as %s", BROKER, PORT, USER)
        client.subscribe(f"mf/v1/site/{SITE}/asset/+/command", qos=1)
        for m in MACHINES.values():                  # announce current state after (re)connect
            self.publish(m, "status", {"status": m.status})
            self.publish(m, "event", {"event_type": "online"})

    def on_message(self, client, userdata, msg):
        asset_id = msg.topic.split("/")[5]
        m = MACHINES.get(asset_id)
        if not m:
            return
        try:
            cmd = json.loads(msg.payload)
        except ValueError:
            log.warning("ignoring non-JSON command on %s", msg.topic)
            return
        command = cmd.get("command")
        with m.lock:
            if command == "start_order":
                if m.order_number == cmd.get("order_number"):
                    # re-dispatch (e.g. after a reconnect): confirm we are still on it
                    self.publish(m, "event", {"event_type": "order_started", "order_number": m.order_number,
                                              "part_number": m.part_number})
                    return
                if m.order_number:
                    log.warning("%s busy with %s; rejecting %s", asset_id, m.order_number, cmd.get("order_number"))
                    self.publish(m, "event", {"event_type": "command_rejected", "command": command,
                                              "order_number": cmd.get("order_number"), "reason": "busy"})
                    return
                m.order_number, m.part_number = cmd.get("order_number"), cmd.get("part_number")
                m.next_cycle_at = time.monotonic() + m.cycle_seconds / SPEED
                self.publish(m, "event", {"event_type": "order_started", "order_number": m.order_number,
                                          "part_number": m.part_number})
                self.set_status(m, "running")
                log.info("%s started %s (%s)", asset_id, m.order_number, m.part_number)
            elif command == "complete_order":
                if m.order_number and m.order_number == cmd.get("order_number"):
                    log.info("%s completed %s", asset_id, m.order_number)
                    self.publish(m, "event", {"event_type": "order_closed", "order_number": m.order_number})
                    m.order_number = m.part_number = None
                    if m.status == "running":
                        self.set_status(m, "idle")
            elif command == "inject_fault":
                ok = self.inject_fault_locked(m, cmd.get("reason_code"), cmd.get("duration_seconds"))
                if not ok:
                    self.publish(m, "event", {"event_type": "command_rejected", "command": command,
                                              "reason": "not_running"})
            else:
                log.info("%s: unknown command %r acknowledged", asset_id, command)
                self.publish(m, "event", {"event_type": "command_ack", "command": command})

    # ------------------------------------------------------------------ behaviour
    def inject_fault_locked(self, m: Machine, code: str | None = None, seconds: float | None = None) -> bool:
        """Put a RUNNING machine into a fault now. Caller must hold m.lock."""
        if m.status != "running":
            return False
        options = FAULTS[m.kind]
        chosen = next((f for f in options if f[0] == (code or "").upper()), None) or random.choice(options)
        m.fault = chosen
        m.fault_until = time.monotonic() + (seconds if seconds else DEMO_FAULT_SECONDS)
        self.set_status(m, "faulted", chosen)
        log.info("%s FAULT %s (injected, %.0fs)", m.asset_id, chosen[0], m.fault_until - time.monotonic())
        return True

    def demo_schedule(self) -> None:
        """In demo mode, fault the next running machine in rotation every DEMO_FAULT_EVERY seconds."""
        if not DEMO_MODE or time.monotonic() < self.next_demo_fault:
            return
        order = list(MACHINES.values())
        for step in range(len(order)):
            m = order[(self.demo_turn + step) % len(order)]
            with m.lock:
                if self.inject_fault_locked(m):
                    self.demo_turn = (self.demo_turn + step + 1) % len(order)
                    self.next_demo_fault = time.monotonic() + DEMO_FAULT_EVERY
                    return
        self.next_demo_fault = time.monotonic() + 5     # nobody running yet; look again shortly

    def set_status(self, m: Machine, status: str, reason: tuple | None = None) -> None:
        if m.status == status:
            return
        m.status = status
        body = {"status": status}
        if reason:
            body.update(reason_code=reason[0], reason_description=reason[1])
        self.publish(m, "status", body)

    def tick(self, m: Machine) -> None:
        t = time.monotonic()
        with m.lock:
            if m.status == "faulted" and t >= m.fault_until:
                m.fault = None
                self.publish(m, "event", {"event_type": "fault_cleared"})
                self.set_status(m, "running" if m.order_number else "idle")
                m.next_cycle_at = t + m.cycle_seconds / SPEED

            if m.status != "running" or t < m.next_cycle_at:
                return

            if random.random() < FAULT_RATE:
                m.fault = random.choice(FAULTS[m.kind])
                m.fault_until = t + random.uniform(20, 120) / SPEED
                self.set_status(m, "faulted", m.fault)
                log.info("%s FAULT %s", m.asset_id, m.fault[0])
                return

            m.cycle_count += 1
            scrap = random.random() < SCRAP_RATE
            event = {"event_type": "cycle_complete", "quantity": 1,
                     "order_number": m.order_number, "part_number": m.part_number,
                     "cycle_time_s": round(m.cycle_seconds * random.uniform(0.95, 1.12), 2),
                     "quality_result": "scrap" if scrap else "good"}
            if scrap:
                event["defect_code"] = random.choice(DEFECTS[m.kind])
            self.publish(m, "event", event)
            m.next_cycle_at = t + m.cycle_seconds * random.uniform(0.95, 1.12) / SPEED

    def run(self) -> None:
        self.client.reconnect_delay_set(min_delay=1, max_delay=30)
        self.client.connect_async(BROKER, PORT, keepalive=30)
        self.client.loop_start()
        last_telemetry = 0.0
        last_status = 0.0
        while not self.stop.is_set():
            for m in MACHINES.values():
                self.tick(m)
            self.demo_schedule()
            if time.monotonic() - last_telemetry >= TELEMETRY_SECONDS and self.client.is_connected():
                last_telemetry = time.monotonic()
                for m in MACHINES.values():
                    s, u = m.signals()
                    self.publish(m, "telemetry", {"signals": s, "units": u}, qos=0)
            # Re-announce state every 15 s. Status is otherwise sent only on change, so if the
            # cloud side was still starting when we connected, it would never learn we are idle.
            if time.monotonic() - last_status >= 15 and self.client.is_connected():
                last_status = time.monotonic()
                for m in MACHINES.values():
                    self.publish(m, "status", {"status": m.status})
            time.sleep(0.2)
        self.client.loop_stop()
        self.client.disconnect()


if __name__ == "__main__":
    factory = Factory()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: factory.stop.set())
    log.info("Manufaction virtual factory starting (site=%s, speed=%sx, demo_mode=%s)", SITE, SPEED, DEMO_MODE)
    factory.run()
    sys.exit(0)
