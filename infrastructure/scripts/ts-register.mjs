// node --experimental-strip-types --import ./infrastructure/scripts/ts-register.mjs <script>
import { register } from "node:module";

register("./ts-hooks.mjs", import.meta.url);
