import { createServer } from "http";
import { loadConfig, createPool } from "./db";
import { ComplianceConsumer } from "./consumer";
import { promClient } from "./metrics";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.postgresUrl);
  const consumer = new ComplianceConsumer(config, pool);

  const metricsServer = createServer(async (req, res) => {
    if (req.url === "/metrics") {
      res.setHeader("Content-Type", promClient.register.contentType);
      res.end(await promClient.register.metrics());
    } else if (req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "healthy", service: "compliance-worker" }));
    } else {
      res.statusCode = 404;
      res.end("Not found");
    }
  });

  metricsServer.listen(9091, () => {
    console.log("Compliance worker metrics on :9091");
  });

  await consumer.start();

  const shutdown = async (): Promise<void> => {
    console.log("Shutting down compliance worker...");
    await consumer.stop();
    await pool.end();
    metricsServer.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
