import { AppProviders } from "@/components/app-providers";

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
