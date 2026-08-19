/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  // Pin the workspace root to this project directory so Next.js doesn't
  // get confused by the lockfile at C:\Users\HP\package-lock.json.
  outputFileTracingRoot: path.join(__dirname),
  basePath: process.env.NEXT_PUBLIC_BASE_PATH,
  assetPrefix: process.env.NEXT_PUBLIC_BASE_PATH,
  images: {
    domains: [
      'images.unsplash.com',
      'i.ibb.co',
      'scontent.fotp8-1.fna.fbcdn.net',
    ],
    unoptimized: true,
  },
};

module.exports = nextConfig;
