import { count, error } from "console";
import dotenv from "dotenv";
import fastify, { FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyIO from "fastify-socket.io";
import { Server, Socket } from "socket.io";
import Redis from "ioredis";
import closeWithGrace from "close-with-grace";
import { randomUUID } from "crypto";

dotenv.config();

const PORT = parseInt(process.env.PORT || "3001", 10);
const Host = process.env.HOST || "0.0.0.0";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || "default-value";
const CONNECTION_COUNT_KEY = "chat:connection-count";
const CONNECTION_COUNT_UPDATE_CHANNEL = "chat:connection-count-updated";
const NEW_MESSAGE_CHANNEL = "chat:new-message";
const MESSAGES_KEY = "chat:messages";

let connectedClients = 0;

if (!UPSTASH_REDIS_REST_URL) {
  console.log("missing UPSTASH_REDIS_REST_URL");
  process.exit(1);
}

declare module "fastify" {
  interface FastifyInstance {
    io: Socket;
  }
}

// Create an instance of Redis (one publisher and one subscriber)
const publisher = new Redis(UPSTASH_REDIS_REST_URL);
const subscriber = new Redis(UPSTASH_REDIS_REST_URL);

async function buildServer() {
  const app = fastify();

  const currentCount = await publisher.get(CONNECTION_COUNT_KEY);

  if (!currentCount) {
    await publisher.set(CONNECTION_COUNT_KEY, 0);
  }

  // Register a CORS plugin
  await app.register(fastifyCors, {
    origin: CORS_ORIGIN,
  });

  // WebSocket connection using fastifyIO
  await app.register(fastifyIO);

  app.io.on("connection", async (io) => {
    console.log("Client connected");

    const incResult = await publisher.incr(CONNECTION_COUNT_KEY);
    connectedClients++;

    await publisher.publish(CONNECTION_COUNT_UPDATE_CHANNEL, String(incResult));

    io.on(NEW_MESSAGE_CHANNEL, async (payload: any) => {
      const message = payload.message;

      if (!message) {
        return;
      }

      console.log(message);
      //pushing to redis
      await publisher.publish(NEW_MESSAGE_CHANNEL, message.toString());
    });

    io.on("disconnect", async () => {
      console.log("Client disconnected");

      if (connectedClients > 0) {
        const decrResult = await publisher.decr(CONNECTION_COUNT_KEY);
        await publisher.publish(
          CONNECTION_COUNT_UPDATE_CHANNEL,
          String(decrResult)
        );
        connectedClients--;

        // Ensure the count does not become negative
        connectedClients = Math.max(connectedClients, 0);
      }
    });
  });

  subscriber.on("message", (channel, text) => {
    if (channel === CONNECTION_COUNT_UPDATE_CHANNEL) {
      app.io.emit(CONNECTION_COUNT_UPDATE_CHANNEL, {
        count: text,
      });
      return;
    }
    if (channel === NEW_MESSAGE_CHANNEL) {
      app.io.emit(NEW_MESSAGE_CHANNEL, {
        message: text,
        id: randomUUID(),
        createdAt: new Date(),
        port: PORT,
      });
      return;
    }
  });

  app.get("/healthcheck", (request, reply) => {
    console.log("Health check request received");
    reply.send({
      status: "ok",
      port: PORT,
    });
  });
  
  return app;
}

subscriber.subscribe(CONNECTION_COUNT_UPDATE_CHANNEL, (err, count) => {
  if (err) {
    console.error(
      `Error subscribing to ${CONNECTION_COUNT_UPDATE_CHANNEL}`,
      err
    );
    return;
  }
  console.log(
    `${count} clients subscribe to ${CONNECTION_COUNT_UPDATE_CHANNEL}`
  );
});

// 2nd suscriber

subscriber.subscribe(NEW_MESSAGE_CHANNEL, (err, count) => {
  if (err) {
    console.error(`Error subscring to ${NEW_MESSAGE_CHANNEL}`);
    return;
  }

  console.log(`${count} clients connected to ${NEW_MESSAGE_CHANNEL}`);
});

// Main function responsible for starting the Server
async function main() {
  const app = await buildServer();

  try {
    await app.listen({
      port: PORT,
      host: Host,
    });

    closeWithGrace({ delay: 2000 }, async ({ signal, err, manual }) => {
      console.log("Shutting down");
      console.log({ signal, err });

      if (connectedClients > 0) {
        console.log(`Removing ${connectedClients} from the count`);

        const currentCount = parseInt(
          (await publisher.get(CONNECTION_COUNT_KEY)) || "0",
          10
        );
        const newCount = Math.max(currentCount - connectedClients, 0);

        await publisher.set(CONNECTION_COUNT_KEY, newCount);
      }

      await app.close();

      console.log("Shutdown complete. Goodbye!");
    });

    console.log(`Server started at http://${Host}:${PORT}`);
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
}

main();
