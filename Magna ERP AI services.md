# Use Case 1 \-  Vidya Sagar AI lead Project Task

# **AI-Powered Magna ERP 16 Lead, Project & Task Automation**

## **Scope of Work, Architecture & Business Logic**

### **1\. Objective**

Build an AI assistant on top of **Frappe ERPNext 16** that understands natural-language instructions, researches publicly available business/contact information from the Internet, proposes ERPNext records, asks for user confirmation at every important action, and then creates/updates ERPNext records.

The AI should behave like an intelligent ERP assistant rather than directly executing uncontrolled actions.

**Primary workflow:**

User Request → Internet Research → AI Proposal → User Confirmation → ERPNext Lead → Project Proposal → Confirmation → Project Creation → Task Proposal → Confirmation → Task Creation → Assignment → Confirmation

---

# **2\. Scope of Work**

### **A. AI Assistant**

The assistant should accept natural-language commands such as:

> "Create a lead for Prince Gupta from Bajaj Finance. They are interested in our Data Engineering services and want a POC first."

The AI should understand:

* Person/Contact Name  
* Company  
* Requirement  
* Interested Service/Product  
* Business opportunity  
* POC requirement  
* Expected next step

---

### **B. Internet Research**

After receiving the request, the AI should search publicly available Internet sources to identify relevant information.

Possible information:

* Person's name  
* Designation  
* Company  
* Company website  
* Office address  
* Public business email  
* Public business phone  
* LinkedIn/public professional profile  
* Company industry  
* Company location  
* Other relevant business information

**Important:** Do not scrape private, restricted, authenticated, or sensitive information. Prefer official company websites and publicly available professional/business sources.

The AI should distinguish between:

**Verified information**

* Found on reliable/official source

**Possible information**

* Found on secondary source and requires confirmation

**Unknown information**

* Could not be reliably found

---

# **3\. Confirmation-First Business Logic**

The AI must **NOT automatically create ERPNext records**.

It should first present the proposed information.

Example:

> I found the following information for Prince Gupta from Bajaj Finance:

> Name: Prince Gupta  
> Company: Bajaj Finance  
> Designation: XXXXX  
> Office Address: XXXXX  
> Email: XXXXX  
> Requirement: Data Engineering Services  
> Opportunity: POC followed by potential order

> I am ready to create this Lead in ERPNext.

> **Do you want to suggest any changes?**

User can respond naturally:

> "The office address is incorrect. Use the Mumbai branch."

AI searches/retrieves the Mumbai branch information and responds:

> I found the following Mumbai office address:

> XXXXX

> **Is this address correct?**

Only after:

> "Yes"

should the AI create the Lead.

---

# **4\. ERPNext Integration**

The AI should integrate with ERPNext 16 through secure APIs rather than directly manipulating the database.

Recommended approach:

**AI → Backend API Layer → Frappe REST API → ERPNext**

The integration should support:

### **Lead**

Create/update:

* Lead Name  
* Company  
* Contact  
* Email  
* Phone  
* Address  
* Job Title/Designation  
* Source  
* Industry  
* Notes  
* Requirements  
* Opportunity information

### **Project**

Create:

* Project Name  
* Customer  
* Project Description  
* Expected Start Date  
* Expected End Date  
* Status  
* Assign Project Manager/Owner

### **Task**

Create:

* Task Subject  
* Project  
* Description  
* Expected Start Date  
* Expected End Date  
* Priority  
* Assigned Employee/User

### **Assignment**

Assign ERPNext Tasks to selected employees.

---

# **5\. Recommended Architecture**

                   USER  
                      |  
                      v  
              AI Chat Interface  
                      |  
                      v  
              AI Orchestrator API  
                      |  
                      v  
                 LANGGRAPH  
                      |  
       \+------------------------------+---------------------------------------+  
       |                                     |                                                 |  
       v                                    v                                                v  
  Intent/Entity                Web Research                        ERPNext Tools  
    Extraction                          Agent                                   / APIs  
       |                                          |                                            |  
       \+-----------------------------------+-------------------------------------+  
                      |  
                      v  
             Validation Layer  
                      |  
                      v  
             Confirmation Gate  
                      |  
             \+-------------------------------------------+  
             |                                                     |  
          User YES                            User CHANGE  
             |                                                     |  
             v                                                    v  
        ERPNext Action                      Research Again  
             |  
             v  
          ERPNext 16

---

# **6\. LangGraph Design**

Use **LangGraph** as the main orchestration/state-management framework.

Recommended nodes:

START  
  ↓  
Intent Detection  
  ↓  
Entity Extraction  
  ↓  
Research Agent  
  ↓  
Information Validation  
  ↓  
Lead Proposal  
  ↓  
Human Confirmation  
  ↓  
Create Lead  
  ↓  
Project Requirement Analysis  
  ↓  
Project Proposal  
  ↓  
Human Confirmation  
  ↓  
Create Project  
  ↓  
Task Planning  
  ↓  
Human Confirmation  
  ↓  
Create Tasks  
  ↓  
Assignment Proposal  
  ↓  
Human Confirmation  
  ↓  
Assign Tasks  
  ↓  
END

LangGraph **state** should maintain:

conversation\_id  
user\_request  
customer\_name  
contact\_name  
company  
designation  
email  
phone  
address  
research\_sources  
research\_confidence  
lead\_data  
project\_data  
task\_data  
employee\_assignments  
confirmation\_status  
current\_step  
audit\_log

Use LangGraph checkpoints so the workflow can pause and resume after user confirmation.

---

# **7\. Recommended Tech Stack**

### **AI**

* OpenAI GPT API  
* LangGraph  
* LangChain  
* Structured Outputs / JSON Schema  
* Embeddings only if internal company knowledge is required

### **Backend**

* Python  
* Async HTTP client

### **ERP**

* Frappe ERPNext 16  
* Frappe REST API  
* ERPNext DocType APIs

### **Web Research**

Use a search API/provider such as:

* Tavily  
* SerpAPI  
* Bing/Web Search API  
* Another compliant search provider

The developer should implement the research layer as a replaceable service so the search provider can be changed later.

### **Frontend**

Existing ERPNext/Frappe UI can be extended, or build a:

* React  
* Chat-based interface

### **Database/State**

* PostgreSQL for AI workflow/session state if required  
* LangGraph checkpoint persistence

### **Security**

* API authentication  
* ERPNext API credentials/service user  
* Role-based permissions  
* Audit logging  
* No unrestricted database access from the AI

---

# **8\. Critical Human-Approval Rules**

The following actions **MUST require explicit user confirmation**:

1. Create Lead  
2. Modify Lead  
3. Create Project  
4. Create Task  
5. Assign Task  
6. Change Task assignment  
7. Send external communication  
8. Delete ERPNext records

The AI can **research, calculate, prepare and recommend**, but execution must pass through a confirmation gate.

Example:

> I am ready to create the following Project:

> **Customer Dashboard – Mutual Fund Investors POC**

> Customer: Bajaj Finance  
> Technology: PySpark, Airflow, Amazon Redshift  
> Objective: Customer dashboard for mutual fund investors

> **Shall I create this Project?**

User: **Yes**

Only then execute.

---

# **9\. Scenario 1 — Lead Creation**

### **User**

> Create a lead for Prince Gupta from Bajaj Finance. They are interested in Data Engineering Services and want a POC first.

### **AI**

1. Extract entities.  
2. Search public Internet sources.  
3. Collect relevant information.  
4. Validate/confidence-score information.  
5. Present proposed Lead.  
6. Ask for corrections.  
7. Update information if the user requests changes.  
8. Ask for final confirmation.  
9. Create ERPNext Lead.  
10. Return ERPNext Lead ID/link or details.

### **Expected response**

> I have created the Lead for Prince Gupta from Bajaj Finance in ERPNext.

> Lead ID: LEAD-XXXXX.

> Would you like me to create a Project for the Data Engineering POC?

---

# **10\. Scenario 2 — Project Creation**

### **User**

> Yes. They want to build a customer dashboard for their Mutual Fund Investors. We will use PySpark, Airflow and Redshift for the POC.

AI should identify:

**Project:** Bajaj Finance – Mutual Fund Investor Dashboard POC

**Objective:** Build proof-of-concept customer dashboard.

**Technology:**

* PySpark  
* Apache Airflow  
* Amazon Redshift

AI should propose:

> I have prepared the following Project:

> Project: Bajaj Finance – Mutual Fund Investor Dashboard POC  
> Objective: Build a customer dashboard for mutual fund investors  
> Technology: PySpark, Airflow, Redshift

> **Should I create this Project?**

After confirmation → create Project.

---

# **11\. Scenario 3 — Task Creation & Assignment**

AI should break the POC into practical tasks.

Example:

1. Understand data requirements  
2. Design data pipeline  
3. Develop PySpark transformation  
4. Configure Airflow workflow  
5. Load processed data into Redshift  
6. Prepare dashboard dataset  
7. Test pipeline  
8. Prepare POC demonstration

AI should NOT automatically assign employees.

It should first ask:

> I have prepared 8 tasks for the POC. Would you like me to create these Tasks?

After confirmation:

> The tasks are ready. I recommend:

> PySpark Development → Data Engineer A  
> Airflow Pipeline → Data Engineer B  
> Redshift/Data Model → Data Engineer C

> Shall I assign them accordingly?

After confirmation → create assignments.

---

# **12\. Example End-to-End Conversation**

### **User**

> Create a lead for Prince Gupta from Bajaj Finance. They need Data Engineering services.

### **AI**

> I found information about Prince Gupta and Bajaj Finance. I have prepared the following Lead.

> Name: Prince Gupta  
> Company: Bajaj Finance  
> Requirement: Data Engineering Services  
> Opportunity: POC followed by potential order  
> Address: Mumbai, XXXXX  
> Email: XXXXX

> Would you like to suggest any changes?

### **User**

> Address is incorrect. Use Mumbai branch.

### **AI**

> I found the Mumbai branch address:

> XXXXX

> Is this correct?

### **User**

> Yes.

### **AI**

> The Lead has been created successfully in ERPNext.

> Would you like me to create the Data Engineering POC Project?

### **User**

> Yes. Customer dashboard for Mutual Fund Investors using PySpark, Airflow and Redshift.

### **AI**

> I have prepared the Project. Shall I create it?

### **User**

> Yes.

### **AI**

> Project created. I have identified 8 development tasks. Shall I create them?

### **User**

> Yes.

### **AI**

> Tasks created. I recommend assigning them to Data Engineer A, B and C. Shall I assign them?

### **User**

> Yes.

### **AI**

> Done. The Project, Tasks and assignments have been created successfully in ERPNext.

---

# **13\. Example 2 — Incorrect Information**

### **User**

> Create a Lead for Amit Sharma from ABC Technologies.

AI searches and finds multiple Amit Sharmas.

Instead of guessing:

> I found three possible Amit Sharma profiles associated with ABC Technologies. I cannot confidently determine which person you mean.

> Please provide his designation, location, LinkedIn profile, or another identifying detail.

The AI must never choose a potentially incorrect person when confidence is low.

---

# **14\. Example 3 — Existing Customer**

### **User**

> Create a Lead for Rahul from XYZ Ltd.

AI searches ERPNext first.

If XYZ Ltd already exists:

> XYZ Ltd already exists as a Customer in ERPNext. Rahul appears to be a new contact.

> Would you like me to create Rahul as a Contact and create an Opportunity instead of a Lead?

This prevents duplicate ERP records.

---

# **15\. Important Development Requirements**

### **Duplicate Detection**

Before creating:

* Lead  
* Customer  
* Contact  
* Project  
* Task

search ERPNext for existing records.

### **Audit Trail**

Store:

* User request  
* AI decision  
* Internet sources  
* Data proposed  
* User corrections  
* User confirmations  
* ERPNext API request  
* ERPNext response  
* Timestamp  
* User ID

### **Error Handling**

If ERPNext API fails:

> I could not create the Lead because ERPNext returned an error. No duplicate record has been created.

The workflow should be safely resumable.

### **Permission Control**

AI should execute actions using a dedicated ERPNext API user with only required permissions.

---

# **16\. Development Priority**

Build an MVP in this order:

**Phase 1:** Chat \+ LangGraph \+ ERPNext API

**Phase 2:** Lead research \+ Lead confirmation \+ Lead creation

**Phase 3:** Project creation

**Phase 4:** Task generation

**Phase 5:** Employee assignment

**Phase 6:** Duplicate detection \+ audit logs \+ error recovery

**Phase 7:** Testing with real-world conversations

The first working MVP should demonstrate the complete flow:

**Internet Research → Lead Proposal → User Correction → Confirmation → Lead Creation → Project Proposal → Confirmation → Project Creation → Task Proposal → Confirmation → Task Creation → Assignment Confirmation → Assignment**

This should be the primary acceptance test for the developer.

# **Important points** 

1. **Confidence Score:** AI should calculate confidence for researched information and never guess when confidence is low. (This is for internal development)  
2. **Source References:** Show where each Internet detail came from, especially address, designation and email.(Mention this in Bottom \- in small font size)  
3. **Duplicate Prevention:** Before creating a Lead, Contact, Customer, Project or Task, search ERPNext for existing records.  
4. **Human Approval:** No ERPNext write operation should happen without explicit confirmation.  
5. **Rollback/Error Handling:** If an API call fails midway, the workflow should safely resume without creating duplicates.  
6. **Conversation Memory:** LangGraph should remember the user's corrections and confirmations throughout the workflow.  
7. **ERPNext Permissions:** AI should operate through a dedicated API user with restricted permissions.  
8. **Audit Log:** Store the original request, research results, AI decisions, confirmations, API actions and timestamps.  
9. **Testing:** Create at least **20 real-world test conversations**, including incorrect information, duplicate records, ambiguous contacts, API failures and user changes.  
10. **MVP First:** Build the complete Lead → Project → Task → Assignment workflow first, then add advanced features.

# Tab 2

