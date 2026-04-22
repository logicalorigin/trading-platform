import app from "./app";
import { logger } from "./logger";

const port = Number(process.env["PORT"] ?? "5002");

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "IBKR bridge listening");
});
