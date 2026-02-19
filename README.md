# IA Learning Backend

Backend service for the IA Learning platform built with NestJS.

## 🚀 Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd ia-learning-backend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run start:dev
```

The application will be available at `http://localhost:3000`.

## 📝 Available Scripts

- `npm run start` - Start the application
- `npm run start:dev` - Start the application in development mode with hot-reload
- `npm run start:debug` - Start the application in debug mode
- `npm run start:prod` - Start the application in production mode
- `npm run build` - Build the application
- `npm run test` - Run unit tests
- `npm run test:e2e` - Run end-to-end tests
- `npm run test:cov` - Run tests with coverage
- `npm run lint` - Lint the code
- `npm run format` - Format the code

## 🏗️ Project Structure

```
src/
├── core/           # Core module with global configurations
│   ├── filters/    # Exception filters
│   ├── guards/     # Authentication guards
│   ├── interceptors/# Request/Response interceptors
│   └── middlewares/# Global middlewares
├── shared/         # Shared module with common utilities
│   └── utils/      # Utility functions
├── health/         # Health check module
│   ├── controllers/# Health check endpoints
│   ├── models/     # Health check DTOs and types
│   └── services/   # Health check business logic
└── main.ts         # Application entry point
```

## 🧪 Testing

The project uses Jest for testing. You can run the tests using:

```bash
npm run test
```

For end-to-end testing:

```bash
npm run test:e2e
```

## 📚 API Documentation

### Health Check Endpoints

- `GET /health` - Check application health status
- `GET /health/test` - Smoke test endpoint

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the ISC License. # Nedi_back
