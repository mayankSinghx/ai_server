import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

// Extend Express Request type to include user property
declare global {
    namespace Express {
        interface Request {
            user?: DecodedToken;
        }
    }
}

interface DecodedToken {
    id: number
    username: string;
    iat?: number;
    exp?: number;
}

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    try {
        // Get token from Authorization header
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            res.status(401).json({
                message: "Unauthorized - No token provided"
            });
            return;
        }

        // Extract token (handle both "Bearer <token>" and direct token formats)
        let token: string;
        if (authHeader.startsWith("Bearer ")) {
            token = authHeader.substring(7);
        } else {
            token = authHeader;
        }

        // Verify JWT secret exists
        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET is not defined in environment variables");
        }

        // Verify and decode token
        const decoded = jwt.verify(token, process.env.JWT_SECRET) as DecodedToken;

        // Attach user info to request object
        req.user = decoded;

        // Continue to next middleware/route handler
        next();
    } catch (error) {
        // Handle specific JWT errors
        if (error instanceof jwt.JsonWebTokenError) {
            res.status(401).json({
                message: "Unauthorized - Invalid token"
            });
            return;
        }

        if (error instanceof jwt.TokenExpiredError) {
            res.status(401).json({
                message: "Unauthorized - Token expired"
            });
            return;
        }

        // Handle other errors
        res.status(500).json({
            message: "Internal server error during authentication"
        });
        return;
    }
}

export default authMiddleware;
