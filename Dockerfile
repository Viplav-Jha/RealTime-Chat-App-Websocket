# Stage 1: Build the base image
FROM node:18-alpine AS base

# Set the working directory inside the container
WORKDIR /app

# Copy the source code from the local 'src' directory to the container's '/app/src' directory
COPY src ./src

# Copy package.json and package-lock.json to the container's '/app' directory
COPY package*.json ./

# Copy tsconfig.json and tsconfig.prod.json to the container's '/app' directory
COPY tsconfig*.json ./

# Install Node.js dependencies using npm
RUN npm install


# Stage 2: Build the app
FROM base AS build

# Set the working directory inside the container to /app
WORKDIR /app

# Run the npm run build command to build the application
RUN npm run build

# Stage 3: Production
FROM node:18-alpine

# Set the working directory inside the container to /app
WORKDIR /app

# Copy package.json and package-lock.json to the container's /app directory
COPY package*.json ./

# Install production-only Node.js dependencies
RUN npm install --only-production

# Copy the build artifacts from the build stage to the production stage
COPY --from=build /app/build ./

# Specify the command to run when the container starts
CMD ["node", "main.js"] 
