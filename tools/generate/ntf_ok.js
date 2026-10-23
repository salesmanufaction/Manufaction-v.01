// The webhook answered. Record the outcome so a failed alert is retried and a delivered one is not.
const db = global.get('db');
const ok = msg.statusCode >= 200 && msg.statusCode < 300;
if (!ok) node.warn('webhook returned HTTP ' + msg.statusCode + ' for notification ' + msg.notification_id);
await db.query(
    `UPDATE mf.notifications
        SET delivered_at = CASE WHEN $2 THEN NOW() ELSE delivered_at END,
            delivery_attempts = delivery_attempts + 1,
            last_attempt_at = NOW(),
            last_error = CASE WHEN $2 THEN NULL ELSE left($3, 200) END
      WHERE id = $1 AND delivered_at IS NULL`,
    [msg.notification_id, ok, ok ? null : 'HTTP ' + msg.statusCode]);
return null;
