import { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";

export const validateRequest = (schema: z.ZodType) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await schema.parseAsync({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        body: req.body,
        query: req.query,
        params: req.params
      });
      next();
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        const errors = error.issues.map((err) => ({
          field: err.path.join("."),
          message: err.message
        }));
        res.status(400).json({
          error: "Validation failed",
          details: errors
        });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    }
  };
