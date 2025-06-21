# API Documentation

Complete API reference for the User Service.

## Base URL

```
Development: http://localhost:3000/api/v1
Production: https://api.yourservice.com/api/v1
```

## Authentication

Most endpoints require authentication using JWT tokens.

### Headers

```http
Authorization: Bearer <access_token>
X-Tenant-ID: <tenant_id>
```

## Endpoints

### Authentication

#### Register

```http
POST /auth/register
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "profile": {
    "name": "John Doe"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "clb1234567",
      "email": "user@example.com",
      "profile": {
        "name": "John Doe"
      }
    },
    "tokens": {
      "accessToken": "eyJ...",
      "refreshToken": "eyJ...",
      "expiresIn": 86400
    }
  }
}
```

#### Login

```http
POST /auth/login
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "clb1234567",
      "email": "user@example.com"
    },
    "tokens": {
      "accessToken": "eyJ...",
      "refreshToken": "eyJ...",
      "expiresIn": 86400
    }
  }
}
```

#### Logout

```http
POST /auth/logout
Authorization: Bearer <access_token>
```

#### Refresh Token

```http
POST /auth/refresh
```

Cookie: `refreshToken=<refresh_token>`

#### Magic Link

```http
POST /auth/magic-link
```

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

#### Verify Magic Link

```http
POST /auth/magic-link/verify
```

**Request Body:**
```json
{
  "token": "magic-link-token"
}
```

### Multi-Factor Authentication (MFA)

#### Setup TOTP

```http
POST /auth/mfa/totp/setup
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "setupToken": "setup-token",
    "secret": "JBSWY3DPEHPK3PXP",
    "qrCode": "data:image/png;base64,..."
  }
}
```

#### Verify TOTP Setup

```http
POST /auth/mfa/totp/verify-setup
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "setupToken": "setup-token",
  "code": "123456"
}
```

#### Setup WebAuthn

```http
POST /auth/mfa/webauthn/setup
Authorization: Bearer <access_token>
```

#### List MFA Methods

```http
GET /auth/mfa
Authorization: Bearer <access_token>
```

### Social Authentication

#### Get Authorization URL

```http
GET /auth/social/:provider/authorize?redirectUri=<redirect_uri>
```

Providers: `google`, `github`, `microsoft`

#### Handle Callback

```http
POST /auth/social/:provider/callback
```

**Request Body:**
```json
{
  "code": "authorization-code",
  "state": "state-token"
}
```

### User Management

#### Get Profile

```http
GET /users/profile
Authorization: Bearer <access_token>
```

#### Update Profile

```http
PATCH /users/profile
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "name": "John Doe",
  "bio": "Software Developer",
  "location": "San Francisco, CA",
  "website": "https://johndoe.com"
}
```

#### Change Password

```http
POST /users/change-password
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "currentPassword": "OldPass123!",
  "newPassword": "NewPass456!"
}
```

#### Upload Avatar

```http
POST /users/avatar
Authorization: Bearer <access_token>
Content-Type: multipart/form-data
```

**Form Data:**
- `file`: Image file (JPEG, PNG, GIF, WebP)

#### Delete Avatar

```http
DELETE /users/avatar
Authorization: Bearer <access_token>
```

#### Search Users

```http
GET /users/search?q=john&limit=20&offset=0
Authorization: Bearer <access_token>
```

### Organizations

#### Create Organization

```http
POST /organizations
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "name": "Acme Corp",
  "slug": "acme-corp",
  "description": "We make everything"
}
```

#### List Organizations

```http
GET /organizations
Authorization: Bearer <access_token>
```

#### Get Organization

```http
GET /organizations/:orgId
Authorization: Bearer <access_token>
```

#### Update Organization

```http
PATCH /organizations/:orgId
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "name": "Acme Corporation",
  "description": "We make everything better"
}
```

#### Delete Organization

```http
DELETE /organizations/:orgId
Authorization: Bearer <access_token>
```

### Organization Members

#### List Members

```http
GET /organizations/:orgId/members
Authorization: Bearer <access_token>
```

#### Add Member

```http
POST /organizations/:orgId/members
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "email": "newmember@example.com",
  "role": "MEMBER"
}
```

Roles: `ADMIN`, `MEMBER`, `GUEST`

#### Update Member Role

```http
PATCH /organizations/:orgId/members/:memberId
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "role": "ADMIN"
}
```

#### Remove Member

```http
DELETE /organizations/:orgId/members/:memberId
Authorization: Bearer <access_token>
```

### Teams

#### Create Team

```http
POST /organizations/:orgId/teams
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "name": "Engineering",
  "description": "Engineering team",
  "permissions": ["repos.read", "repos.write"]
}
```

#### List Teams

```http
GET /organizations/:orgId/teams
Authorization: Bearer <access_token>
```

#### Get Team

```http
GET /teams/:teamId
Authorization: Bearer <access_token>
```

#### Update Team

```http
PATCH /teams/:teamId
Authorization: Bearer <access_token>
```

#### Delete Team

```http
DELETE /teams/:teamId
Authorization: Bearer <access_token>
```

### Team Members

#### List Team Members

```http
GET /teams/:teamId/members
Authorization: Bearer <access_token>
```

#### Add Team Member

```http
POST /teams/:teamId/members
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "email": "member@example.com",
  "role": "member"
}
```

#### Remove Team Member

```http
DELETE /teams/:teamId/members/:memberId
Authorization: Bearer <access_token>
```

### Invitations

#### Send Invitation

```http
POST /organizations/:orgId/invitations
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "email": "invitee@example.com",
  "role": "MEMBER",
  "message": "Welcome to our team!",
  "expiresInDays": 7
}
```

#### List Invitations

```http
GET /organizations/:orgId/invitations?status=pending
Authorization: Bearer <access_token>
```

#### Get Invitation

```http
GET /invitations/:token
```

#### Accept Invitation

```http
POST /invitations/:token/accept
```

#### Revoke Invitation

```http
DELETE /invitations/:invitationId
Authorization: Bearer <access_token>
```

### Devices

#### List Devices

```http
GET /devices
Authorization: Bearer <access_token>
```

#### Get Device

```http
GET /devices/:deviceId
Authorization: Bearer <access_token>
```

#### Register Device

```http
POST /devices
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "name": "My MacBook",
  "type": "DESKTOP"
}
```

#### Trust Device

```http
POST /devices/:deviceId/trust
Authorization: Bearer <access_token>
```

#### Logout Device

```http
POST /devices/:deviceId/logout
Authorization: Bearer <access_token>
```

#### Remove Device

```http
DELETE /devices/:deviceId
Authorization: Bearer <access_token>
```

### Sessions

#### List Sessions

```http
GET /sessions?active=true
Authorization: Bearer <access_token>
```

#### Get Session

```http
GET /sessions/:sessionId
Authorization: Bearer <access_token>
```

#### Revoke Session

```http
DELETE /sessions/:sessionId
Authorization: Bearer <access_token>
```

#### Revoke All Sessions

```http
POST /sessions/revoke-all
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "exceptCurrent": true
}
```

### Audit Logs

#### List Audit Logs

```http
GET /audit?action=login&limit=50
Authorization: Bearer <access_token>
```

#### Get Audit Statistics

```http
GET /audit/stats?days=30
Authorization: Bearer <access_token>
```

#### Export Audit Logs

```http
GET /audit/export?format=csv
Authorization: Bearer <access_token>
```

### Admin (Requires Admin Privileges)

#### Create Tenant

```http
POST /admin/tenants
Authorization: Bearer <admin_token>
```

**Request Body:**
```json
{
  "name": "New Company",
  "slug": "new-company",
  "config": {
    "auth": {
      "allowedMethods": ["email", "magic-link"],
      "requireInvitation": false
    },
    "features": {
      "organizations": true,
      "mfa": true
    }
  }
}
```

#### List Tenants

```http
GET /admin/tenants?status=ACTIVE
Authorization: Bearer <admin_token>
```

#### Get Tenant

```http
GET /admin/tenants/:tenantId
Authorization: Bearer <admin_token>
```

#### Update Tenant

```http
PATCH /admin/tenants/:tenantId
Authorization: Bearer <admin_token>
```

#### Suspend Tenant

```http
POST /admin/tenants/:tenantId/suspend
Authorization: Bearer <admin_token>
```

**Request Body:**
```json
{
  "reason": "Payment overdue"
}
```

#### System Statistics

```http
GET /admin/stats
Authorization: Bearer <admin_token>
```

## Error Responses

All error responses follow this format:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email is required",
    "details": {
      "field": "email"
    }
  },
  "metadata": {
    "timestamp": "2024-01-01T00:00:00.000Z",
    "requestId": "req_123456"
  }
}
```

### Error Codes

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `VALIDATION_ERROR` | Invalid input data | 400 |
| `AUTHENTICATION_ERROR` | Invalid credentials | 401 |
| `FORBIDDEN` | Insufficient permissions | 403 |
| `NOT_FOUND` | Resource not found | 404 |
| `CONFLICT` | Resource already exists | 409 |
| `RATE_LIMIT_EXCEEDED` | Too many requests | 429 |
| `INTERNAL_ERROR` | Server error | 500 |

## Rate Limiting

API requests are rate-limited:

- **Anonymous**: 100 requests per 15 minutes
- **Authenticated**: 1000 requests per 15 minutes
- **Admin**: 5000 requests per 15 minutes

Rate limit headers:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200
```

## Pagination

List endpoints support pagination:

```http
GET /endpoint?limit=20&offset=0
```

Response includes pagination metadata:

```json
{
  "data": [...],
  "pagination": {
    "total": 100,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

## Webhooks

Configure webhooks for real-time events:

- `user.created`
- `user.updated`
- `user.deleted`
- `organization.created`
- `organization.member.added`
- `organization.member.removed`
- `session.created`
- `mfa.enabled`
- `mfa.disabled`

## OpenAPI Documentation

Interactive API documentation is available at:

```
http://localhost:3000/api/docs
```

OpenAPI specification:

```
http://localhost:3000/api/docs/openapi.json
```