import { VaultProvider } from "@/lib/vault";
import { WalletProvider } from "@/lib/wallet";
import { RouteStage } from "@/components/RouteStage";

export default function StartLayout({ children }: { children: React.ReactNode }) {
  return (
    <VaultProvider idle>
      <WalletProvider>
        <div style={{ display: "flex", height: "var(--app-h)" }}>
          <RouteStage>{children}</RouteStage>
        </div>
      </WalletProvider>
    </VaultProvider>
  );
}
