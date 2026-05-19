import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload, GetPublicKeyOrSecret } from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { PrismaClient } from "@prisma/client";

interface DecodedToken extends JwtPayload {
  sub: string;
  "custom:role"?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        email?: string;
      };
    }
  }
}

const useMockAuth = process.env.MOCK_AUTH !== "false";
const prisma = new PrismaClient();

const DEFAULT_MOCK_USERS = {
  manager: {
    id: "010be580-60a1-70ae-780e-18a6fd94ad32",
    email: "john.smith@example.com",
  },
  tenant: {
    id: "817b3540-a061-707b-742a-a28391181149",
    email: "carol.white@example.com",
  },
} as const;

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (useMockAuth) {
    const roleHeader = req.header("x-mock-role") || "manager";
    const normalizedRole =
      roleHeader.toLowerCase() === "tenant" ? "tenant" : "manager";
    const defaultMockUser = DEFAULT_MOCK_USERS[normalizedRole];

    req.user = {
      id: req.header("x-mock-user-id") || defaultMockUser.id,
      role: normalizedRole,
      email: req.header("x-mock-email") || defaultMockUser.email,
    };

    if (normalizedRole === "manager") {
      await prisma.manager.upsert({
        where: { cognitoId: req.user.id },
        update: {
          email: req.user.email || defaultMockUser.email,
        },
        create: {
          cognitoId: req.user.id,
          name: "Mock Manager",
          email: req.user.email || defaultMockUser.email,
          phoneNumber: "+1 (555) 000-0000",
        },
      });
    } else {
      await prisma.tenant.upsert({
        where: { cognitoId: req.user.id },
        update: {
          email: req.user.email || defaultMockUser.email,
        },
        create: {
          cognitoId: req.user.id,
          name: "Mock Tenant",
          email: req.user.email || defaultMockUser.email,
          phoneNumber: "+1 (555) 000-0000",
        },
      });
    }

    next();
    return;
  }

  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const region = process.env.AWS_REGION;
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_APP_CLIENT_ID;

    if (!region || !userPoolId || !clientId) {
      res.status(500).json({ message: "Auth is not configured" });
      return;
    }

    const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
    const client = jwksClient({
      jwksUri: `${issuer}/.well-known/jwks.json`,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });

    const getKey: GetPublicKeyOrSecret = (header, callback) => {
      client.getSigningKey(header.kid as string, (err, key) => {
        if (err || !key) {
          callback(err || new Error("Signing key not found"));
          return;
        }

        callback(null, key.getPublicKey());
      });
    };

    const decoded = await new Promise<DecodedToken>((resolve, reject) => {
      jwt.verify(
        token,
        getKey,
        { issuer, algorithms: ["RS256"] },
        (err, payload) => {
          if (err || !payload) {
            reject(err || new Error("Token verification failed"));
            return;
          }

          resolve(payload as DecodedToken);
        }
      );
    });

    const tokenUse = decoded.token_use;
    const isAccessToken = tokenUse === "access";
    const isIdToken = tokenUse === "id";

    if (!isAccessToken && !isIdToken) {
      res.status(401).json({ message: "Invalid token type" });
      return;
    }

    if (isIdToken && decoded.aud !== clientId) {
      res.status(401).json({ message: "Invalid token audience" });
      return;
    }

    if (isAccessToken && decoded.client_id !== clientId) {
      res.status(401).json({ message: "Invalid token client" });
      return;
    }

    req.user = {
      id: decoded.sub,
      role: decoded["custom:role"] || "",
      email: decoded.email as string | undefined,
    };

    next();
  } catch (err) {
    console.error("Failed to verify token:", err);
    res.status(401).json({ message: "Invalid token" });
  }
};

export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.user?.role?.toLowerCase();

    if (!role) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    if (!allowedRoles.map((allowedRole) => allowedRole.toLowerCase()).includes(role)) {
      res.status(403).json({ message: "Access denied" });
      return;
    }

    next();
  };
};
