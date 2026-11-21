import express from "express";
export declare function createApp(): express.Express;
export declare function bootstrapState(app: express.Express): Promise<void>;
