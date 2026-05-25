import { expose } from "comlink";
import { analyticsWorkerApi } from "./analyticsWorkerApi";

expose(analyticsWorkerApi);
