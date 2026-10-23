// The webhook could not be reached (DNS, refused, timeout). Keep the message short and never log the URL:
// Slack and Teams webhook URLs contain a secret token.
const db = global.get('db');
if (msg.notification_id == null) return null;
const why = String((msg.error && msg.error.message) || 'request failed').replace(/https?:\/\/\S+/g, '[url]').slice(0, 150);
node.warn('webhook send failed for notification ' + msg.notification_id + ': ' + why);
await db.query(
    `UPDATE mf.notifications
        SET delivery_attempts = delivery_attempts + 1, last_attempt_at = NOW(), last_error = left($2, 200)
      WHERE id = $1 AND delivered_at IS NULL`, [msg.notification_id, why]);
return null;
