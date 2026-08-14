/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // genlayer-js touches browser-only globals (crypto, etc.) that
    // break a server-side webpack build if bundled directly. This
    // externals block is a "never change" item per the build guide
    // -- it's the fix, not a workaround to revisit later.
    if (isServer) {
      config.externals = [...(config.externals || []), "genlayer-js"];
    }
    return config;
  },
};

module.exports = nextConfig;
