import { RecoverAccountPage } from "./RecoverAccountPage";

export function UmfSupportRecoveryPage() {
  return (
    <RecoverAccountPage
      apiPath="/api/umf-support"
      returnPath="/umf-support/access"
      corporate
    />
  );
}
