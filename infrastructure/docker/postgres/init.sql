-- Create keycloak database
CREATE DATABASE keycloak;

-- Create extensions for user_service database
\c user_service;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";