"use client";

import dynamic from "next/dynamic";

// The whole app is dynamically imported with ssr:false. Everything
// downstream of App.tsx touches localStorage (the burner wallet) or
// the genlayer-js client, neither of which exist during server
// render. This is the one place that boundary is drawn -- every
// component below this is safely "client-only" by construction.
const App = dynamic(() => import("./App"), { ssr: false });

export default function Page() {
  return <App />;
}
