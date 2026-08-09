import 'server-only';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server env var: ${name}`);
  return value;
}

const subdomain = () => required('NHOST_SUBDOMAIN');
const region = () => required('NHOST_REGION');

export const serverEnv = {
  get hasuraUrl() {
    return `https://${subdomain()}.hasura.${region()}.nhost.run`;
  },
  get graphqlUrl() {
    return `https://${subdomain()}.graphql.${region()}.nhost.run/v1`;
  },
  get adminSecret() {
    return required('HASURA_ADMIN_SECRET');
  },
  get actionSecret() {
    return required('ACTION_SECRET');
  },
  get groqApiKey() {
    return process.env.GROQ_API_KEY || '';
  },
  get groqModel() {
    return process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  },
  get slackWebhookUrl() {
    return process.env.SLACK_WEBHOOK_URL || '';
  },
};
