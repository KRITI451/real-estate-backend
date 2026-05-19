#!/bin/bash

set -e

POOL_NAME="real-estate-user-pool"
CLIENT_NAME="real-estate-service-client"

echo "Setting up Cognito User Pool: $POOL_NAME..."

# -----------------------------
# 1. GET OR CREATE USER POOL
# -----------------------------
USER_POOL_ID=$(aws cognito-idp list-user-pools \
  --max-results 60 \
  --query "UserPools[?Name=='$POOL_NAME'].Id" \
  --output text)

if [ "$USER_POOL_ID" == "None" ] || [ -z "$USER_POOL_ID" ]; then
  echo "Creating User Pool..."

  POOL_OUTPUT=$(aws cognito-idp create-user-pool \
    --pool-name "$POOL_NAME" \
    --username-attributes email \
    --auto-verified-attributes email \
    --policies '{
      "PasswordPolicy": {
        "MinimumLength": 8,
        "RequireUppercase": true,
        "RequireLowercase": true,
        "RequireNumbers": true,
        "RequireSymbols": false
      }
    }' \
    --schema '[
      {
        "Name": "role",
        "AttributeDataType": "String",
        "Mutable": true
      }
    ]' \
    --output json)

  USER_POOL_ID=$(echo "$POOL_OUTPUT" | jq -r '.UserPool.Id')
fi

echo "User Pool ID: $USER_POOL_ID"

# -----------------------------
# 2. 🔥 FORCE EMAIL OTP FLOW (CRITICAL FIX)
# -----------------------------
echo "Configuring email verification + OTP..."

aws cognito-idp update-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --auto-verified-attributes email \
  --verification-message-template '{
    "DefaultEmailOption": "CONFIRM_WITH_CODE",
    "EmailSubject": "Verify your account",
    "EmailMessage": "Your verification code is {####}"
  }' \
  --email-configuration EmailSendingAccount=COGNITO_DEFAULT

# -----------------------------
# 3. DISABLE AUTO CONFIRM BEHAVIOR (IMPORTANT)
# -----------------------------
aws cognito-idp update-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --admin-create-user-config '{
    "AllowAdminCreateUserOnly": false
  }'

# -----------------------------
# 4. APP CLIENT
# -----------------------------
CLIENT_ID=$(aws cognito-idp list-user-pool-clients \
  --user-pool-id "$USER_POOL_ID" \
  --query "UserPoolClients[?ClientName=='$CLIENT_NAME'].ClientId" \
  --output text)

if [ "$CLIENT_ID" == "None" ] || [ -z "$CLIENT_ID" ]; then
  echo "Creating App Client..."

  CLIENT_OUTPUT=$(aws cognito-idp create-user-pool-client \
    --user-pool-id "$USER_POOL_ID" \
    --client-name "$CLIENT_NAME" \
    --no-generate-secret \
    --explicit-auth-flows \
      ALLOW_USER_PASSWORD_AUTH \
      ALLOW_REFRESH_TOKEN_AUTH \
    --output json)

  CLIENT_ID=$(echo "$CLIENT_OUTPUT" | jq -r '.UserPoolClient.ClientId')
fi

# -----------------------------
# 5. OUTPUT ENV
# -----------------------------
echo "--------------------------------------"
echo "COGNITO_USER_POOL_ID=$USER_POOL_ID"
echo "COGNITO_APP_CLIENT_ID=$CLIENT_ID"
echo "--------------------------------------"
