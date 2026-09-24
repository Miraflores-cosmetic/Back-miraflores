/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    'react-quill',
    '@miraflores/order-chat-core',
    '@miraflores/order-chat-ui',
  ],
  // Согласовано с Nest VIDEO_MAX (80 МБ) и nginx client_max_body_size 100m
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
};

module.exports = nextConfig;
