FROM node:13

RUN mkdir -p /app
WORKDIR /app

COPY package*.json /app/
RUN npm install
COPY . /app/

RUN ./node_modules/.bin/tsc

CMD node src/index.js