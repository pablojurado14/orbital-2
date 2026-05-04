import { auth } from "@/auth";
import Sidebar from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const userEmail = session?.user?.email ?? null;

  return (
    <div style={{ display: "flex", height: "100vh", background: "#F5F1EB", overflow: "hidden" }}>
      <div style={{ flexShrink: 0, position: "sticky", top: 0, height: "100vh" }}>
        <Sidebar userEmail={userEmail} />
      </div>
      <main style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
        {children}
      </main>
    </div>
  );
}