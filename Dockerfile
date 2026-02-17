# Vi bruger en let version af Node.js
FROM node:20-alpine

# Sæt mappen vi arbejder i
WORKDIR /app

# Kopier package-filer først (så Docker kan genbruge cachen hvis du ikke ændrer dem)
COPY package*.json ./

# Installer pakkerne (inklusive tsx og express)
RUN npm install

# Kopier resten af dine filer (server.ts osv.)
COPY . .

# Fortæl Railway at vi lytter på en port (den vælger selv porten, men dette er god skik)
EXPOSE 3000

# Start serveren med den kommando vi lavede i package.json ("tsx src/server.ts")
CMD ["npm", "start"]