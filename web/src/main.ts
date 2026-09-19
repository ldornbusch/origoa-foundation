import { installRouter } from "./router";
import { connectSession } from "./ws";
import "./app";

installRouter();
connectSession();
