"use client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { OrgPolicyView } from "@/lib/queries/admin/org-policy";
import { AgentsPolicyTab } from "./AgentsPolicyTab";
import { AuditTab } from "./AuditTab";
import { IntegrationsPolicyTab } from "./IntegrationsPolicyTab";
import { PlanOverrideTab } from "./PlanOverrideTab";

/** SPEC-069c — política da organização para o `platform_admin` (agentes e IA, integrações, plano e features, auditoria). Abas roláveis no celular. */
export function OrgPolicyPanel({ policy }: { policy: OrgPolicyView }) {
  return (
    <section aria-labelledby="org-policy-title" className="space-y-3">
      <h3 id="org-policy-title" className="font-heading text-lg font-semibold">
        Política da organização
      </h3>
      <Tabs defaultValue="agents">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList className="h-auto min-w-max">
            <TabsTrigger value="agents" className="h-10 sm:h-7">Agentes e IA</TabsTrigger>
            <TabsTrigger value="integrations" className="h-10 sm:h-7">Integrações</TabsTrigger>
            <TabsTrigger value="plan" className="h-10 sm:h-7">Plano e features</TabsTrigger>
            <TabsTrigger value="audit" className="h-10 sm:h-7">Auditoria</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="agents"><AgentsPolicyTab policy={policy} /></TabsContent>
        <TabsContent value="integrations"><IntegrationsPolicyTab policy={policy} /></TabsContent>
        <TabsContent value="plan"><PlanOverrideTab policy={policy} /></TabsContent>
        <TabsContent value="audit"><AuditTab audit={policy.audit} /></TabsContent>
      </Tabs>
    </section>
  );
}
