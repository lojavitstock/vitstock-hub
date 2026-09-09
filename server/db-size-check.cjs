const { Client } = require("pg");

const c = new Client({
  host: "127.0.0.1",
  port: 54498,
  user: "postgres",
  password: process.env.PGPASSWORD,
  database: "railway",
  ssl: false
});

const q = `
SELECT
  TO_CHAR(
    DATE_TRUNC('month', to_timestamp("messageTimestamp")),
    'YYYY-MM'
  ) AS month,

  COUNT(*) AS messages,

  COUNT(*) FILTER (
    WHERE "messageType" IN (
      'imageMessage',
      'videoMessage',
      'audioMessage',
      'documentMessage',
      'stickerMessage'
    )
  ) AS media_messages

FROM public."Message"

GROUP BY DATE_TRUNC('month', to_timestamp("messageTimestamp"))
ORDER BY DATE_TRUNC('month', to_timestamp("messageTimestamp")) DESC;
`;

c.connect()
  .then(() => c.query(q))
  .then(r => console.table(r.rows))
  .catch(err => console.error(err))
  .finally(() => c.end());
