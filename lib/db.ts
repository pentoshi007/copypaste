import mongoose, { type Connection } from "mongoose";

declare global {
  var mongoose:
    | { conn: Connection | null; promise: Promise<Connection> | null }
    | undefined;
}

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error(
    "Please define the MONGODB_URI environment variable inside .env.local"
  );
}

async function dbConnect(): Promise<Connection> {
  const cached = global.mongoose;

  if (cached?.conn) {
    return cached.conn;
  }

  if (!cached?.promise) {
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false,
      maxPoolSize: 10,
      minPoolSize: 1,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    };

    const promise = mongoose
      .connect(MONGODB_URI!, opts)
      .then((m) => m.connection);

    global.mongoose = { conn: null, promise };
  }

  const conn = await global.mongoose!.promise!;
  global.mongoose!.conn = conn;
  return conn;
}

export default dbConnect;
