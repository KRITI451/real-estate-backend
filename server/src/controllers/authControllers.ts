import { Request, Response } from "express";
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import crypto from "crypto";

const authConfig = {
  region: process.env.AWS_REGION || "ap-south-1",
  clientId: process.env.COGNITO_APP_CLIENT_ID,
  clientSecret: process.env.COGNITO_APP_CLIENT_SECRET,
};

if (!authConfig.clientId) {
  console.warn("Missing Cognito App Client ID");
}

const cognitoClient = new CognitoIdentityProviderClient({
  region: authConfig.region,
});

/**
 * SECRET HASH (required if client secret is enabled)
 */
function computeSecretHash(username: string): string {
  if (!authConfig.clientSecret || !authConfig.clientId) return "";

  return crypto
    .createHmac("sha256", authConfig.clientSecret)
    .update(username + authConfig.clientId)
    .digest("base64");
}

/**
 * NORMALIZE ROLE
 */
function normalizeRole(role: string): "tenant" | "manager" | null {
  const lower = role.toLowerCase();
  if (lower === "tenant" || lower === "manager") return lower;
  return null;
}

/**
 * REGISTER USER (FIXED)
 * Uses SignUpCommand → avoids duplicate + password mismatch issues
 */
export const registerUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name, phoneNumber, role } = req.body;

    if (!email || !password || !role) {
      res.status(400).json({ message: "email, password, and role are required" });
      return;
    }

    const normalizedRole = normalizeRole(role);
    if (!normalizedRole) {
      res.status(400).json({ message: "role must be tenant or manager" });
      return;
    }

    const secretHash = computeSecretHash(email);

    const signUpParams: any = {
      ClientId: authConfig.clientId,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "name", Value: name || "" },
        { Name: "phone_number", Value: phoneNumber || "" },
        { Name: "custom:role", Value: normalizedRole },
      ],
    };

    if (secretHash) {
      signUpParams.SecretHash = secretHash;
    }

    const response = await cognitoClient.send(new SignUpCommand(signUpParams));

    res.status(201).json({
      message: "User registered successfully",
      userSub: response.UserSub,
      confirmed: response.UserConfirmed,
      role: normalizedRole,
    });
  } catch (error: any) {
    const message = error?.message || "Unknown error";
    const code = error?.name;

    if (code === "UsernameExistsException") {
      res.status(409).json({
        message: "User already exists",
      });
      return;
    }

    res.status(500).json({
      message: `Registration failed: ${message}`,
    });
  }
};

/**
 * LOGIN USER (UNCHANGED BUT CLEAN)
 */
export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: "email and password are required" });
      return;
    }

    const authParams: Record<string, string> = {
      USERNAME: email,
      PASSWORD: password,
    };

    const secretHash = computeSecretHash(email);
    if (secretHash) {
      authParams.SECRET_HASH = secretHash;
    }

    const authResponse = await cognitoClient.send(
      new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: authConfig.clientId,
        AuthParameters: authParams,
      })
    );

    res.json({
      message: "Login successful",
      authenticationResult: authResponse.AuthenticationResult,
    });
  } catch (error: any) {
    res.status(401).json({
      message: error?.message || "Login failed",
    });
  }
};

/**
 * CONFIRM SIGN UP (EMAIL CONFIRMATION)
 */
export const confirmSignUp = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      res.status(400).json({ message: "email and code are required" });
      return;
    }

    const secretHash = computeSecretHash(email);

    const confirmParams: any = {
      ClientId: authConfig.clientId,
      Username: email,
      ConfirmationCode: code,
    };

    if (secretHash) {
      confirmParams.SecretHash = secretHash;
    }

    await cognitoClient.send(new ConfirmSignUpCommand(confirmParams));

    res.json({ message: "Email confirmed successfully. You can now login." });
  } catch (error: any) {
    res.status(400).json({
      message: error?.message || "Confirmation failed",
    });
  }
};
