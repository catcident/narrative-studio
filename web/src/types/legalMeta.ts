export interface LegalFooterMeta {
  schema_version: number;
  company: {
    name: string;
    registration_number: string;
    representative: string;
    address: string;
    phone: string;
    email?: string;
    fax?: string;
    ecommerce_registration_number?: string;
    reporting_authority?: string;
    extra_disclosure: string;
    updated_at: string | null;
  };
  links: {
    terms: string;
    privacy: string;
    marketing: string;
    business_info: string;
  };
}
