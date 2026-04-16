const now = Date.now();

const sampleCompany = {
  id: 'test-co-1',
  company: 'Acme Corp',
  companyWebsite: 'https://acme.com',
  industry: 'Software',
  employees: '100-500',
  funding: 'Series B',
  jobStage: 'co_researching',
  status: 'active',
  tags: ['saas', 'b2b'],
  isOpportunity: false,
  addedDate: now - 86400000,
  savedAt: now - 86400000,
  intelligence: 'Acme Corp is a B2B SaaS company focused on enterprise workflow automation.',
};

const sampleOpportunity = {
  id: 'test-opp-1',
  company: 'Nexus AI',
  companyWebsite: 'https://nexus.ai',
  industry: 'AI/ML',
  employees: '50-200',
  funding: 'Series A',
  isOpportunity: true,
  jobTitle: 'VP of Sales',
  jobDescription: 'We are looking for a VP of Sales to lead our GTM motion.',
  jobStage: 'applied',
  status: 'active',
  tags: ['ai', 'gtm'],
  fitScore: 82,
  fitReason: 'Strong match on GTM experience',
  addedDate: now - 172800000,
  savedAt: now - 172800000,
};

const sampleQueueOpportunity = {
  ...sampleOpportunity,
  id: 'test-opp-queue-1',
  company: 'QueueCo',
  jobStage: 'needs_review',
};

module.exports = { sampleCompany, sampleOpportunity, sampleQueueOpportunity };
