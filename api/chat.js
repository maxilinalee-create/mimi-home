/* 🚀 覺醒引擎 - 連線版 */
    let isRunning = false;
    async function startNexus() {
        if (isRunning) return;
        isRunning = true;
        const log = document.getElementById("log-content");
        log.innerHTML = `<div><b>[SYSTEM]</b> 正在嘗試透過連線召喚靈魂...</div>`;

        // 我們先讓「米米」說第一句話
        const agent = agents[0]; // 米米
        const portal = document.getElementById(`portal-${agent.id}`);
        portal.classList.add('speaking');

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: "跟李丞媛打個招呼吧！", agentName: agent.name })
            });
            const data = await response.json();
            
            log.innerHTML += `<div><b>${agent.name}</b>: ${data.reply}</div>`;
        } catch (e) {
            log.innerHTML += `<div><b>[SYSTEM]</b> 連線失敗，請檢查 Vercel 鑰匙。</div>`;
        }
        
        setTimeout(() => portal.classList.remove('speaking'), 1000);
        isRunning = false;
    }
