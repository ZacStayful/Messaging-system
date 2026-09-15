import { config } from "dotenv";

// Local secrets first, then defaults. Never commit .env.local.
config({ path: ".env.local" });
config({ path: ".env" });
