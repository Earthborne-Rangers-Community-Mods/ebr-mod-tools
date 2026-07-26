import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { themeStore } from "./lib/theme.svelte.js";

// Apply the stored theme before mounting so the first paint is correct.
themeStore.init();

const app = mount(App, { target: document.getElementById("app") as HTMLElement });

export default app;
