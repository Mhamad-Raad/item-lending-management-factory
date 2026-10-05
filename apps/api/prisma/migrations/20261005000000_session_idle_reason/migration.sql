-- Q136: a session left without a refresh for longer than the idle limit is ended by the next refresh that
-- presents its cookie, and its family says why.
ALTER TYPE "session_revoke_reason" ADD VALUE 'IDLE';
