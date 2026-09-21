const API_BASE_URL = 'http://localhost:8000';

export const api = {
    // 1. Start Interview & Generate Questions with optional Job Description
    async startInterview(roleTitle = 'Software Engineer', userId = null, jobDescription = null) {
        const response = await fetch(`${API_BASE_URL}/api/interviews/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                role_title: roleTitle,
                user_id: userId,
                job_description: jobDescription || null,
            }),
        });
        if (!response.ok) throw new Error('Failed to start interview');
        return response.json();
    },

    // 2. Submit Single Question Answer & Video
    async submitAnswer(interviewId, { questionIndex, questionText, candidateAnswer, videoBlob }) {
        const formData = new FormData();
        formData.append('question_index', questionIndex);
        formData.append('question_text', questionText);
        formData.append('candidate_answer', candidateAnswer || '');

        if (videoBlob) {
            formData.append('video', videoBlob, `q_${questionIndex}.webm`);
        }

        const response = await fetch(`${API_BASE_URL}/api/interviews/${interviewId}/submit-answer`, {
            method: 'POST',
            body: formData,
        });
        if (!response.ok) throw new Error('Failed to submit answer');
        return response.json();
    },

    // 3. Complete Interview & Run Evaluation
    async completeInterview(interviewId, visionMetrics = {}) {
        const response = await fetch(`${API_BASE_URL}/api/interviews/${interviewId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vision_metrics: visionMetrics }),
        });
        if (!response.ok) throw new Error('Failed to complete evaluation');
        return response.json();
    },

    // 4. Get Evaluation Report
    async getReport(interviewId) {
        const response = await fetch(`${API_BASE_URL}/api/interviews/${interviewId}/report`);
        if (!response.ok) throw new Error('Failed to fetch report');
        return response.json();
    },

    // 5. Get User Past Interviews
    async getUserInterviews(userId) {
        const response = await fetch(`${API_BASE_URL}/api/interviews/user/${userId}`);
        if (!response.ok) throw new Error('Failed to fetch user history');
        return response.json();
    },
};