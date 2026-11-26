import type { CreateApp } from "../types.js";
import { makeApp as after } from "./after/app.js";
import { makeApp as before } from "./before/app.js";

export const createApp: CreateApp = (form, opts) => (form === "before" ? before(opts) : after(opts));
