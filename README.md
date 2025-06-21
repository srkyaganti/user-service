# User Service

A comprehensive, production-ready multi-tenant authentication and user management service built with Bun, Hono, and Prisma.

## 🚀 Features

### Authentication
- **Multiple Auth Methods**: Email/password, magic links, social login (Google, GitHub, Microsoft)
- **Multi-Factor Authentication (MFA)**: TOTP (Google Authenticator) and WebAuthn (Passkeys)
- **Session Management**: Device tracking, concurrent session control
- **JWT-based Authentication**: Secure token generation and validation
- **Account Activation**: Optional email verification with customizable requirements

### User Management
- **Profile Management**: Avatar upload, profile updates, email changes
- **Account Security**: Password policies, account deletion, audit logging
- **Device Management**: Track and manage trusted devices
- **User Search**: Find users by email or profile data
- **Default Roles**: B2B-ready with super_admin, admin, manager, and member roles

### Organization & Teams
- **Multi-tenant Organizations**: Create and manage organizations
- **Team Management**: Create teams within organizations
- **Role-Based Access Control (RBAC)**: Owner, Admin, Member, Guest roles
- **Invitation System**: Email-based invitations with expiration

### Tenant Configuration (NEW)
- **Login Method Control**: Enable/disable specific authentication methods per tenant
- **MFA Enforcement**: Require MFA for all users or admins only
- **Password Policies**: Customizable password requirements per tenant
- **Account Activation**: Require email verification before account access
- **Session Configuration**: Customizable session timeout and token expiry

### Security & Compliance
- **Audit Logging**: Track all user actions and system events
- **Rate Limiting**: Protect against abuse
- **Email Verification**: Ensure valid email addresses
- **Secure Password Storage**: Using Argon2 hashing
- **Tenant Admin Privileges**: First user becomes admin, can grant/revoke admin access

### Admin Features
- **Tenant Management**: Create, suspend, and manage tenants
- **System Monitoring**: View system-wide statistics
- **Tenant Isolation**: Complete data isolation between tenants
- **Tenant Settings**: Configure authentication methods, MFA, and password policies
- **User Role Management**: Assign and manage default roles for B2B use cases

## 🛠️ Tech Stack

- **Runtime**: [Bun](https://bun.sh/) - Fast JavaScript runtime
- **Framework**: [Hono](https://hono.dev/) - Lightweight web framework
- **Database**: PostgreSQL with [Prisma](https://www.prisma.io/) ORM
- **Authentication**: JWT with secure token generation
- **Caching**: Redis
- **Job Queue**: BullMQ
- **Email**: Nodemailer with template support
- **File Storage**: Local filesystem (S3 compatible)

## 📋 Prerequisites

- Bun 1.0+
- PostgreSQL 14+
- Redis 6+
- Docker & Docker Compose (optional)

## 🚀 Quick Start

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd user-service
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start dependencies with Docker**
   ```bash
   docker-compose up -d postgres redis mailhog
   ```

5. **Run database migrations**
   ```bash
   bun run db:push
   ```

6. **Start the service**
   ```bash
   bun run dev
   ```

The service will be available at `http://localhost:3000`

## 📖 Documentation

- [Setup Guide](./docs/SETUP.md) - Detailed setup instructions
- [API Documentation](./docs/API.md) - Complete API reference
- [Architecture](./docs/ARCHITECTURE.md) - System architecture overview

## 🔧 Configuration

Key environment variables:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/userservice"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT
JWT_SECRET="your-secret-key"
JWT_EXPIRES_IN="24h"

# Email
SMTP_HOST="localhost"
SMTP_PORT="1025"
SMTP_FROM="noreply@example.com"

# Admin
ADMIN_EMAILS="admin@example.com"
```

See [.env.example](./.env.example) for all configuration options.

## 📂 Project Structure

```
user-service/
├── apps/
│   └── api/                 # API application
│       ├── src/
│       │   ├── routes/     # API routes
│       │   ├── services/   # Business logic
│       │   ├── middleware/ # Express middleware
│       │   └── lib/        # Utilities
│       └── package.json
├── packages/
│   ├── database/           # Prisma schema and client
│   └── shared/            # Shared utilities and types
├── docker-compose.yml     # Docker services
└── package.json          # Root package.json
```

## 🧪 Testing

```bash
# Run all tests
bun test

# Run with coverage
bun test --coverage

# Run specific test file
bun test auth.test.ts
```

## 🚢 Deployment

### Docker

```bash
# Build image
docker build -t user-service .

# Run container
docker run -p 3000:3000 --env-file .env user-service
```

### Production

See [Production Deployment Guide](./docs/DEPLOYMENT.md) for detailed instructions.

## 📊 Monitoring

- **Health Check**: `GET /health`
- **Metrics**: `GET /metrics` (Prometheus format)
- **API Docs**: `GET /api/docs` (Swagger UI)

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Bun](https://bun.sh/)
- Powered by [Hono](https://hono.dev/)
- Database ORM by [Prisma](https://www.prisma.io/)