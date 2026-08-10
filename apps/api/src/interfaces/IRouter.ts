import type { Router } from 'express';

/** A route group that knows how to build its own router. */
export interface IRoute {
    getRoutes(): Router;
}
