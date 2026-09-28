const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');

export const api = {
    // 1. Start Interview & Generate Questions with optional Job Description
    async startInterview(
        roleTitle = 'Software Engineer',
        firebaseUid = null,
        jobDescription = null,
        email = null,
        fullName = null,
        maxTurns = 5,
        interviewMode = 'standard',
    ) {
        const response = await fetch(`${API_BASE_URL}/api/interviews/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                role_title: roleTitle,
                firebase_uid: firebaseUid,
                email,
                full_name: fullName,
                job_description: jobDescription || null,
                max_turns: maxTurns,
                interview_mode: interviewMode,
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

    // Advance after submitAnswer. Pass its response_id to make delayed retries
    // unambiguous even if another answer has since been submitted.
    async nextQuestion(interviewId, responseId = null) {
        const response = await fetch(
            `${API_BASE_URL}/api/interviews/${encodeURIComponent(interviewId)}/next-question`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(responseId ? { response_id: responseId } : {}),
            },
        );
        if (!response.ok) throw new Error('Failed to fetch next question');
        return response.json();
    },

    async useHint(interviewId, currentTurn) {
        const response = await fetch(`${API_BASE_URL}/api/interviews/${encodeURIComponent(interviewId)}/hint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_turn: currentTurn }),
        });
        if (!response.ok) {
            const error = new Error('Could not retrieve hint');
            error.status = response.status;
            throw error;
        }
        return response.json();
    },

    async getArenaResults(interviewId) {
        const response = await fetch(`${API_BASE_URL}/api/interviews/${encodeURIComponent(interviewId)}/arena-results`);
        if (!response.ok) throw new Error('Could not retrieve Arena results');
        return response.json();
    },

    // 3. Complete Interview & Aggregate Saved Evaluation
    async completeInterview(interviewId, visionMetrics = {}, durationSeconds = 0) {
        const safeDuration = Number.isFinite(durationSeconds)
            ? Math.max(0, Math.round(durationSeconds))
            : 0;
        const response = await fetch(`${API_BASE_URL}/api/interviews/${interviewId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                vision_metrics: visionMetrics,
                duration_seconds: safeDuration,
            }),
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
    async getUserInterviews(firebaseUid) {
        const response = await fetch(
            `${API_BASE_URL}/api/interviews/user/${encodeURIComponent(firebaseUid)}`,
        );
        if (!response.ok) throw new Error('Failed to fetch user history');
        return response.json();
    },
};
