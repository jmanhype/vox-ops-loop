# VoxYZ Ops-Loop Documentation Index

## 📚 Complete Documentation Suite

Welcome to the VoxYZ Ops-Loop autonomous multi-agent system documentation. This index provides navigation to all documentation and recommended reading paths for different audiences.

---

## 🗂️ Documentation by Category

### 📖 Conceptual & Overview

#### [System Overview](SYSTEM_OVERVIEW.md)
**Executive-level context for stakeholders and newcomers**

- Executive summary of the Ops-Loop system
- Business problems solved
- High-level architecture diagrams
- Agent role philosophy
- Comparison with alternatives (Cron, Manual, Full Automation)
- Use case categories
- Terminology glossary

**Best for**: Executives, product managers, new team members, stakeholders

**Read time**: 10 minutes

---

### 🏗️ Technical Architecture

#### [Architecture Deep Dive](ARCHITECTURE_DEEP_DIVE.md)
**Comprehensive technical documentation**

- Component architecture (Vercel, Supabase, Local Worker)
- Data flow diagrams with Mermaid sequence charts
- State machine diagrams (proposal & mission lifecycles)
- Complete database schema documentation
- Entity Relationship Diagram (ERD)
- API route specifications
- Real-time architecture
- Scalability and performance characteristics

**Best for**: Architects, senior engineers, technical leads

**Read time**: 30 minutes

**Prerequisites**: None, but System Overview recommended

---

### 🤖 Agent System

#### [Agent Guide](AGENT_GUIDE.md)
**Complete guide to all 6 agent roles**

- Agent system overview and lifecycle
- Individual agent specifications:
  - **Minion**: General task executor
  - **Sage**: Research and analysis
  - **Scout**: Discovery and exploration
  - **Quill**: Content generation
  - **Xalt**: Code and system modifications
  - **Observer**: Supervision and monitoring
- Configuration examples for each agent
- Model selection guidelines
- Tool permissions and capabilities
- Inter-agent communication patterns
- Custom agent development

**Best for**: Developers working with agents, AI engineers

**Read time**: 25 minutes

**Prerequisites**: System Overview

---

### 👨‍💻 Developer Resources

#### [Developer Onboarding](DEVELOPER_ONBOARDING.md)
**Complete guide for new developers**

- Prerequisites and system requirements
- Account setup (Vercel, Supabase)
- Local environment setup
- Database migration procedures
- Running heartbeat and worker locally
- Testing workflows
- Debugging techniques
- Common development tasks
- Development workflow

**Best for**: New developers, anyone setting up local environment

**Read time**: 20 minutes

**Prerequisites**: None (start here!)

#### [Integration Guides](INTEGRATION_GUIDES.md)
**Executor integration and custom development**

- Executor system overview
- Detailed guides for all 6 executors:
  - **OpenClaw**: AI agent executor
  - **Wreckit**: SDLC automation
  - **Radar**: Product roadmap tracking
  - **Minion**: General task execution
  - **Noop**: Testing and dry-run
  - **Custom**: Building your own
- Configuration parameters
- Usage examples
- Troubleshooting
- Integration testing

**Best for**: Developers integrating external systems, extending executors

**Read time**: 35 minutes

**Prerequisites**: Architecture Deep Dive, Agent Guide

---

### 🔧 Configuration & Operations

#### [Policy Configuration](POLICY_CONFIGURATION.md)
**Complete policy reference**

- Policy system overview
- Reaction matrix policy (pattern matching)
- Auto-approval policy
- Proposal caps policy
- Worker policy (security gates)
- Agent roles policy
- Policy testing and validation
- Example policy library (Dev, Production, Testing)

**Best for**: Operators, DevOps engineers, security teams

**Read time**: 30 minutes

**Prerequisites**: System Overview, Architecture Deep Dive

#### [Operations Runbook](OPERATIONS_RUNBOOK.md)
**Production operations handbook**

- Deployment procedures
- Pre-deployment checklist
- Monitoring and observability
- Troubleshooting guide
- Incident response procedures
- Backup and recovery
- Rollback procedures
- Maintenance tasks
- Security hardening

**Best for**: DevOps engineers, SREs, on-call teams

**Read time**: 25 minutes

**Prerequisites**: Developer Onboarding, Policy Configuration

---

### 📋 Reference Documentation

#### [API Reference](API_REFERENCE.md)
**Complete API documentation**

- All Supabase RPC functions (10 functions)
- Vercel API endpoints
- Event schema reference
- Proposal template schema
- Database table reference (8 tables)
- Error reference
- Usage examples for all functions

**Best for**: Developers building integrations, API consumers

**Read time**: 20 minutes (reference)

**Prerequisites**: Architecture Deep Dive

---

## 🎯 Recommended Reading Paths

### For Executives & Stakeholders

**Goal**: Understand what the system does and how it delivers value

**Path** (30 minutes):
1. [System Overview](SYSTEM_OVERVIEW.md) - Executive summary and business value
2. [Architecture Deep Dive](ARCHITECTURE_DEEP_DIVE.md) - High-level architecture (first section only)
3. [Agent Guide](AGENT_GUIDE.md) - Agent philosophy (first section only)

**Focus areas**: Executive summary, business problems, agent philosophy, use cases

---

### For New Developers

**Goal**: Get up and running quickly with local development

**Path** (60 minutes):
1. [System Overview](SYSTEM_OVERVIEW.md) - Context and terminology (15 min)
2. [Developer Onboarding](DEVELOPER_ONBOARDING.md) - Setup and running locally (20 min)
3. [Architecture Deep Dive](ARCHITECTURE_DEEP_DIVE.md) - Technical foundations (25 min)

**Next steps**:
- [Agent Guide](AGENT_GUIDE.md) - When working with agents
- [Integration Guides](INTEGRATION_GUIDES.md) - When integrating systems
- [API Reference](API_REFERENCE.md) - When calling APIs

---

### For DevOps & Site Reliability Engineers

**Goal**: Deploy, monitor, and maintain production system

**Path** (70 minutes):
1. [System Overview](SYSTEM_OVERVIEW.md) - System context (10 min)
2. [Architecture Deep Dive](ARCHITECTURE_DEEP_DIVE.md) - Components and data flow (20 min)
3. [Operations Runbook](OPERATIONS_RUNBOOK.md) - Deployment and operations (25 min)
4. [Policy Configuration](POLICY_CONFIGURATION.md) - Security and policies (15 min)

**Reference as needed**:
- [API Reference](API_REFERENCE.md) - Database queries and functions
- [Developer Onboarding](DEVELOPER_ONBOARDING.md) - Local setup for testing

---

### For Security & Compliance Teams

**Goal**: Understand security model and policy controls

**Path** (50 minutes):
1. [System Overview](SYSTEM_OVERVIEW.md) - System context (10 min)
2. [Architecture Deep Dive](ARCHITECTURE_DEEP_DIVE.md) - Security architecture (15 min)
3. [Policy Configuration](POLICY_CONFIGURATION.md) - Policy framework (20 min)
4. [Operations Runbook](OPERATIONS_RUNBOOK.md) - Security hardening (5 min)

**Focus areas**: Worker policy, tool gating, auto-approval, security hardening

---

### For AI/ML Engineers

**Goal**: Extend or customize agent behavior

**Path** (70 minutes):
1. [System Overview](SYSTEM_OVERVIEW.md) - Agent philosophy (10 min)
2. [Agent Guide](AGENT_GUIDE.md) - All agent roles (25 min)
3. [Integration Guides](INTEGRATION_GUIDES.md) - Executor patterns (20 min)
4. [Policy Configuration](POLICY_CONFIGURATION.md) - Agent configuration (15 min)

**Reference as needed**:
- [API Reference](API_REFERENCE.md) - Database operations
- [Architecture Deep Dive](ARCHITECTURE_DEEP_DIVE.md) - Data flow

---

### For Product Managers

**Goal**: Understand capabilities and plan features

**Path** (40 minutes):
1. [System Overview](SYSTEM_OVERVIEW.md) - Full document (15 min)
2. [Agent Guide](AGENT_GUIDE.md) - What each agent can do (15 min)
3. [Integration Guides](INTEGRATION_GUIDES.md) - Executor capabilities (10 min)

**Focus areas**: Use cases, agent capabilities, integration points

---

### For Integration Partners

**Goal**: Build integrations with external systems

**Path** (60 minutes):
1. [System Overview](SYSTEM_OVERVIEW.md) - Context (10 min)
2. [Architecture Deep Dive](ARCHITECTURE_DEEP_DIVE.md) - Data flow (15 min)
3. [Integration Guides](INTEGRATION_GUIDES.md) - Executor development (20 min)
4. [API Reference](API_REFERENCE.md) - API documentation (15 min)

**Reference as needed**:
- [Agent Guide](AGENT_GUIDE.md) - Agent behavior
- [Policy Configuration](POLICY_CONFIGURATION.md) - Policy gates

---

## 📖 Quick Reference

### Core Concepts

| Concept | Description | Documentation |
|---------|-------------|---------------|
| **Agents** | Autonomous AI workers with specialized roles | [Agent Guide](AGENT_GUIDE.md) |
| **Executors** | Pluggable components that execute mission steps | [Integration Guides](INTEGRATION_GUIDES.md) |
| **Events** | Signals that trigger system activity | [API Reference](API_REFERENCE.md#event-schema) |
| **Reactions** | Pattern-based event responses | [Policy Configuration](POLICY_CONFIGURATION.md#reaction-matrix) |
| **Proposals** | Gated intents requiring approval | [API Reference](API_REFERENCE.md#proposal-schema) |
| **Missions** | Approved projects with sequential steps | [Architecture Deep Dive](ARCHITECTURE_DEEP_DIVE.md#mission-lifecycle) |
| **Policies** | Configuration and security rules | [Policy Configuration](POLICY_CONFIGURATION.md) |

### Key Files

| File | Purpose | Location |
|------|---------|----------|
| Schema definitions | Database tables and types | `/ops-loop/supabase/migrations/0001_ops_schema.sql` |
| SQL functions | RPC functions and logic | `/ops-loop/supabase/migrations/0002_ops_functions.sql` |
| Heartbeat API | Event processing endpoint | `/ops-loop/vercel/pages/api/ops/heartbeat.ts` |
| Worker process | Mission step execution | `/ops-loop/local/src/worker.mjs` |
| Executor registry | Executor routing | `/ops-loop/local/src/executors/index.mjs` |

### Common Tasks

| Task | Quick Start | Full Documentation |
|------|-------------|---------------------|
| **Set up local environment** | [Developer Onboarding](DEVELOPER_ONBOARDING.md#local-environment-setup) | Full guide |
| **Deploy to production** | [Operations Runbook](OPERATIONS_RUNBOOK.md#deployment-procedures) | Full procedures |
| **Configure agents** | [Agent Guide](AGENT_GUIDE.md#agent-configuration) | Full configuration |
| **Set up policies** | [Policy Configuration](POLICY_CONFIGURATION.md#policy-system-overview) | Complete reference |
| **Debug issues** | [Operations Runbook](OPERATIONS_RUNBOOK.md#troubleshooting-guide) | Troubleshooting guide |
| **Integrate external system** | [Integration Guides](INTEGRATION_GUIDES.md#custom-executor-development) | Custom executors |
| **Call APIs** | [API Reference](API_REFERENCE.md#supabase-rpc-functions) | Complete API docs |

---

## 🔗 Cross-References

### Documentation Structure

```
docs/
├── INDEX.md                          ← You are here
├── SYSTEM_OVERVIEW.md                ← Start here for overview
├── ARCHITECTURE_DEEP_DIVE.md         ← Technical foundations
├── AGENT_GUIDE.md                    ← Agent system
├── DEVELOPER_ONBOARDING.md           ← Developer setup
├── POLICY_CONFIGURATION.md           ← Policy reference
├── OPERATIONS_RUNBOOK.md             ← Operations handbook
├── API_REFERENCE.md                  ← API documentation
└── INTEGRATION_GUIDES.md             ← Executor integration
```

### Related Documentation

- **Main README**: `/ops-loop/README.md` - Quick start and blueprint overview
- **Architecture**: `/ops-loop/ARCHITECTURE.md` - High-level system architecture
- **Testing**: `/ops-loop/TESTING.md` - Multi-agent validation results
- **Deployment**: `/ops-loop/DEPLOYMENT.md` - Deployment procedures
- **Examples**: `/ops-loop/examples/test_reactions.md` - Reaction matrix examples

---

## 🆘 Getting Help

### Documentation Issues

If you find:
- **Inaccurate information**: Check against source code and report discrepancies
- **Missing content**: Check if covered in another document via cross-references
- **Broken links**: Verify file paths and report link errors
- **Unclear explanations**: Provide context and request clarification

### System Issues

For system-related issues:
1. Check [Operations Runbook](OPERATIONS_RUNBOOK.md#troubleshooting-guide) first
2. Review error codes in [API Reference](API_REFERENCE.md#error-reference)
3. Check logs and metrics as described in Operations Runbook
4. Follow incident response procedures if urgent

### Contributing

To improve documentation:
1. Maintain consistency with existing patterns
2. Use emoji headers (📋, 🎯, 🏗️, etc.)
3. Provide code examples in JSON, SQL, or bash
4. Cross-reference related documentation
5. Test all code examples against actual implementation

---

## 📝 Document Metadata

| Document | Lines | Last Updated | Purpose |
|----------|-------|--------------|---------|
| INDEX.md | ~400 | 2025-01-21 | Navigation and reading paths |
| SYSTEM_OVERVIEW.md | ~400 | 2025-01-21 | Executive context |
| ARCHITECTURE_DEEP_DIVE.md | ~800 | 2025-01-21 | Technical foundations |
| AGENT_GUIDE.md | ~750 | 2025-01-21 | Agent system reference |
| DEVELOPER_ONBOARDING.md | ~700 | 2025-01-21 | Developer setup guide |
| POLICY_CONFIGURATION.md | ~1,200 | 2025-01-21 | Policy reference |
| OPERATIONS_RUNBOOK.md | ~1,100 | 2025-01-21 | Operations handbook |
| API_REFERENCE.md | ~880 | 2025-01-21 | API documentation |
| INTEGRATION_GUIDES.md | ~1,580 | 2025-01-21 | Executor integration |

**Total Documentation**: ~7,400 lines of comprehensive documentation

---

## 🚀 Quick Start by Role

### "I'm a new developer..."
Start here: [Developer Onboarding](DEVELOPER_ONBOARDING.md)

### "I need to deploy this..."
Start here: [Operations Runbook → Deployment Procedures](OPERATIONS_RUNBOOK.md#deployment-procedures)

### "I want to understand the architecture..."
Start here: [Architecture Deep Dive](ARCHITECTURE_DEEP_DIVE.md)

### "I need to configure agents..."
Start here: [Agent Guide → Agent Configuration](AGENT_GUIDE.md#agent-configuration)

### "I'm troubleshooting an issue..."
Start here: [Operations Runbook → Troubleshooting](OPERATIONS_RUNBOOK.md#troubleshooting-guide)

### "I'm building an integration..."
Start here: [Integration Guides → Custom Executor Development](INTEGRATION_GUIDES.md#custom-executor-development)

---

**Version**: 1.0.0  
**Last Updated**: 2025-01-21  
**Maintainer**: VoxYZ Ops-Loop Team

For the most up-to-date documentation, always refer to the latest version in the repository.
