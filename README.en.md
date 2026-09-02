# Smart Team Build

> An intelligent team building and skill matching platform based on WeChat Mini Program Cloud Development.

## 1. Project Introduction

This project aims to help users efficiently build and manage teams, particularly in competition or project development scenarios. The platform integrates a complete user system, skill assessment system, team management tools, and an intelligent matching engine. Assisted by AI technology, the platform can automatically analyze user skills and generate team requirement suggestions, greatly simplifying the team recruitment and information organization process.

## 2. Core Features

*   **Intelligent Team Matching**:
    *   **Missing Skill Calculation**: The system automatically analyzes team composition and calculates the skills currently missing from the team.
    *   **Matching Pool Mechanism**: Users can enter the matching pool to find suitable teams or members based on skill complementarity.
*   **User & Skill Management**:
    *   **Skill Assessment**: Supports manual skill entry and provides AI-assisted rating functionality.
    *   **Personal Profile**: Supports WeChat avatar upload, personal information completion, and updates.
*   **Competition Management**:
    *   **Document Parsing**: Supports uploading Word documents, utilizing the `mammoth` library to parse and extract content.
    *   **AI Generation**: Integrates AI interfaces to automatically generate competition detail summaries or parse document content.
*   **Team Collaboration**:
    *   **Application & Approval**: Handles requests such as member joining and mentor guidance.
    *   **Status Sync**: Real-time synchronization of team participation status (In Progress, Completed, etc.) and member changes.

## 3. Technical Architecture

*   **Frontend Framework**: WeChat Native Mini Program
*   **UI Component Library**: Vant Weapp (`@vant/weapp`)
*   **Backend Service**: WeChat Cloud Development (Serverless)
    *   **Cloud Functions**: Handle core business logic (located in `cloudfunctions/`)
    *   **Cloud Database**: Store core data such as users, teams, competitions, etc.
*   **State Management**: Flux-style frontend global state management (`store/`)
*   **Main Dependencies**:
    *   `mammoth`: Used for converting Word (.docx) documents to HTML.
    *   `axios`: Used in cloud functions to call external AI interfaces.

## 4. Project Structure

```
├── cloudfunctions/             # Cloud Functions Directory
│   ├── competitionApi/         # Competition Related: File Upload, AI Generation, CRUD
│   ├── matching_poolApi/       # Matching Pool: Enter/Exit, List Query
│   ├── requestApi/             # Request Handling: Join Team, Mentor Application
│   ├── teamsApi/               # Team Core: Member Management, Requirement Calculation
│   ├── userAPI/                # User Management: Skills, Info, Binding
│   └── skill_*/                # Skill CRUD Operations
├── miniprogram_npm/            # Mini Program Dependencies (Vant Weapp, etc.)
├── pages/                      # Common Pages
├── subPackages/                # Business Function Sub-packages
│   ├── admin/                  # Admin Module
│   ├── competition/            # Competition Detail Page
│   ├── joined/                 # Joined Team Management
│   ├── team/                   # Team List, Creation, Management
│   └── user/                   # Personal Center, Registration & Login
├── store/                      # Frontend State Management
├── utils/                      # Utility Functions
└── app.*                       # Mini Program Entry Files
```

## 5. Deployment Guide

1.  **Environment Preparation**: Ensure [WeChat Developer Tools](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) are installed.
2.  **Project Import**: Import this project using WeChat Developer Tools, check "Enable Cloud Development", and select or create a cloud environment.
3.  **Deploy Cloud Functions**:
    *   Right-click on the `cloudfunctions` directory, select "Upload and Deploy: Install Dependencies on Cloud". All cloud functions need to be deployed sequentially.
4.  **Database Configuration**:
    *   Log in to the [WeChat Official Account Platform](https://mp.weixin.qq.com/) or open the Cloud Development Console within the developer tools.
    *   Create the following Collections: `users`, `teams`, `competitions`, `matching_pool`, `requests`, `skills`.
    *   Configure security rules (permissions) for the collections according to business requirements.

## 6. Notes

*   **AI Configuration**: Please configure a valid external AI API Key (`AI_API_KEY`) and interface address (`AI_URL`) in `cloudfunctions/competitionApi/service.js`.
*   **Admin Privileges**: The initial admin account needs to have user permission fields set manually in the database, or bound via code logic.