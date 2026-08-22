FROM node:20-slim

WORKDIR /app

# Copy package files and .npmrc
COPY package*.json .npmrc ./

# Install dependencies with git support
RUN apt-get update && apt-get install -y git && \
    npm install --allow-git=all --production && \
    apt-get purge -y git && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Copy application files
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
