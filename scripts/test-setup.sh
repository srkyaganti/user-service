#!/bin/bash

# Test Setup Script for User Service
# This script sets up the testing environment

set -e

echo "🧪 Setting up test environment for User Service..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required commands exist
check_dependencies() {
    print_status "Checking dependencies..."
    
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    if ! command -v bun &> /dev/null; then
        print_error "Bun is not installed. Please install Bun first."
        exit 1
    fi
    
    print_success "All dependencies are available"
}

# Start test services
start_test_services() {
    print_status "Starting test services..."
    
    # Stop any existing test services
    docker-compose -f docker-compose.test.yml down --remove-orphans 2>/dev/null || true
    
    # Start test services
    if docker-compose -f docker-compose.test.yml up -d; then
        print_success "Test services started"
    else
        print_error "Failed to start test services"
        exit 1
    fi
}

# Wait for services to be ready
wait_for_services() {
    print_status "Waiting for services to be ready..."
    
    # Wait for PostgreSQL
    print_status "Waiting for PostgreSQL..."
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if docker exec user-service-postgres-test pg_isready -U postgres -d userservice_test 2>/dev/null; then
            print_success "PostgreSQL is ready"
            break
        fi
        
        if [ $attempt -eq $max_attempts ]; then
            print_error "PostgreSQL failed to start within $max_attempts seconds"
            exit 1
        fi
        
        echo "Attempt $attempt/$max_attempts: PostgreSQL not ready, waiting..."
        sleep 1
        ((attempt++))
    done
    
    # Wait for Redis
    print_status "Waiting for Redis..."
    attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if docker exec user-service-redis-test redis-cli ping 2>/dev/null | grep -q PONG; then
            print_success "Redis is ready"
            break
        fi
        
        if [ $attempt -eq $max_attempts ]; then
            print_error "Redis failed to start within $max_attempts seconds"
            exit 1
        fi
        
        echo "Attempt $attempt/$max_attempts: Redis not ready, waiting..."
        sleep 1
        ((attempt++))
    done
}

# Setup test database
setup_test_database() {
    print_status "Setting up test database..."
    
    # Copy test environment file
    if [ -f .env.test ]; then
        cp .env.test .env
        print_success "Test environment file copied"
    else
        print_warning "Test environment file not found, using defaults"
    fi
    
    # Generate Prisma client
    print_status "Generating Prisma client..."
    if bun run db:generate; then
        print_success "Prisma client generated"
    else
        print_error "Failed to generate Prisma client"
        exit 1
    fi
    
    # Push database schema
    print_status "Pushing database schema..."
    if DATABASE_URL="postgresql://postgres:password@localhost:5433/userservice_test" bun run db:push --force-reset; then
        print_success "Database schema pushed"
    else
        print_error "Failed to push database schema"
        exit 1
    fi
}

# Install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    
    if bun install; then
        print_success "Dependencies installed"
    else
        print_error "Failed to install dependencies"
        exit 1
    fi
}

# Run tests
run_tests() {
    local test_type="${1:-all}"
    
    print_status "Running $test_type tests..."
    
    case $test_type in
        "unit")
            bun run test:unit
            ;;
        "integration")
            bun run test:integration
            ;;
        "e2e")
            bun run test:e2e
            ;;
        "coverage")
            bun run test:coverage
            ;;
        "all")
            bun run test
            ;;
        *)
            print_error "Unknown test type: $test_type"
            print_status "Available types: unit, integration, e2e, coverage, all"
            exit 1
            ;;
    esac
}

# Cleanup function
cleanup() {
    print_status "Cleaning up test environment..."
    
    # Stop test services
    docker-compose -f docker-compose.test.yml down --remove-orphans 2>/dev/null || true
    
    # Remove test uploads directory
    rm -rf ./test-uploads 2>/dev/null || true
    
    # Restore original .env if it exists
    if [ -f .env.backup ]; then
        mv .env.backup .env
        print_success "Original environment file restored"
    fi
    
    print_success "Cleanup completed"
}

# Main execution
main() {
    local command="${1:-setup}"
    
    case $command in
        "setup")
            check_dependencies
            install_dependencies
            start_test_services
            wait_for_services
            setup_test_database
            print_success "Test environment setup completed!"
            print_status "You can now run tests with: bun run test"
            ;;
        "start")
            start_test_services
            wait_for_services
            ;;
        "stop")
            docker-compose -f docker-compose.test.yml down
            print_success "Test services stopped"
            ;;
        "test")
            run_tests "${2:-all}"
            ;;
        "cleanup")
            cleanup
            ;;
        "reset")
            cleanup
            main setup
            ;;
        "help")
            echo "Usage: $0 [command] [options]"
            echo ""
            echo "Commands:"
            echo "  setup     - Full test environment setup (default)"
            echo "  start     - Start test services only"
            echo "  stop      - Stop test services"
            echo "  test      - Run tests (unit|integration|e2e|coverage|all)"
            echo "  cleanup   - Clean up test environment"
            echo "  reset     - Clean up and setup again"
            echo "  help      - Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 setup           # Full setup"
            echo "  $0 test unit       # Run unit tests only"
            echo "  $0 test coverage   # Run tests with coverage"
            echo "  $0 cleanup         # Clean up everything"
            ;;
        *)
            print_error "Unknown command: $command"
            print_status "Use '$0 help' for usage information"
            exit 1
            ;;
    esac
}

# Trap to cleanup on exit
trap cleanup EXIT

# Run main function with all arguments
main "$@"