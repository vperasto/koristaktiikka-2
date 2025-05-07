document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('strategy-canvas');
    const ctx = canvas.getContext('2d');
    const courtArea = document.getElementById('court-area');
    const sidebar = document.getElementById('sidebar');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');

    let elements = [];
    let selectedElement = null;
    let history = [];
    const MAX_HISTORY_STATES = 20;

    let isDraggingPaletteElement = false;
    // let paletteElementData = null; // Ei käytetä enää, dragstart siirtää datan suoraan
    let isMovingCanvasElement = false;
    let dragOffsetX, dragOffsetY;

    const colors = {
        home: '#EF4444',
        away: '#22D3EE',
        arrow: '#EC4899',
        textLight: '#F8FAFC',
        textDark: '#0F172A',
        selection: '#F97316'
    };

    const PLAYER_RADIUS = 15; // Säädä tätä tarvittaessa suhteessa kentän kokoon
    const ARROW_DEFAULT_LENGTH = Math.min(courtArea.clientWidth * 0.1, 60); // Nuolen pituus suhteessa kenttään
    const ARROW_HEAD_SIZE = 8;

    function init() {
        window.addEventListener('resize', resizeCanvasAndDraw);
        resizeCanvasAndDraw();
        setupEventListeners();
        saveState();
        draw();
        updateCssCourt(document.querySelector('.court-select-btn.active').dataset.courtType); // Aseta alkuperäinen kenttänäkymä
    }

    function resizeCanvasAndDraw() {
        const courtRect = courtArea.getBoundingClientRect();
        if (courtRect.width === 0 || courtRect.height === 0) {
            requestAnimationFrame(resizeCanvasAndDraw);
            return;
        }
        canvas.width = courtRect.width;
        canvas.height = courtRect.height;
        draw();
    }
    
    function setupEventListeners() {
        toggleSidebarBtn.addEventListener('click', () => {
            sidebar.classList.toggle('hidden');
            setTimeout(resizeCanvasAndDraw, 310); // Odota CSS-transitionin loppuun
        });

        document.querySelectorAll('.court-select-btn').forEach(button => {
            button.addEventListener('click', () => {
                document.querySelectorAll('.court-select-btn').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                updateCssCourt(button.dataset.courtType);
                resizeCanvasAndDraw(); // Varmista canvasin koko ja piirrä uudelleen
            });
        });
        
        document.querySelectorAll('.element-btn.draggable').forEach(button => {
            button.addEventListener('dragstart', (e) => {
                isDraggingPaletteElement = true;
                const data = { ...button.dataset };
                e.dataTransfer.setData('application/json', JSON.stringify(data));
                e.dataTransfer.effectAllowed = 'copy';
            });
            button.addEventListener('dragend', () => {
                isDraggingPaletteElement = false;
                // paletteElementData = null; // Ei tarvita enää
            });
        });

        canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const jsonData = e.dataTransfer.getData('application/json');
            if (!jsonData) return;

            const data = JSON.parse(jsonData);
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            createElementOnCanvas(data, x, y);
            isDraggingPaletteElement = false;
        });
        
        canvas.addEventListener('mousedown', handleInteractionStart);
        canvas.addEventListener('touchstart', handleInteractionStart, { passive: false });
        canvas.addEventListener('mousemove', handleInteractionMove);
        canvas.addEventListener('touchmove', handleInteractionMove, { passive: false });
        document.addEventListener('mouseup', handleInteractionEnd); // Kuuntele globaalisti
        document.addEventListener('touchend', handleInteractionEnd); // Kuuntele globaalisti

        document.getElementById('undo-btn').addEventListener('click', undo);
        document.getElementById('clear-btn').addEventListener('click', clearAll);
        document.getElementById('delete-selected-btn').addEventListener('click', deleteSelected);
        document.getElementById('rotate-selected-btn').addEventListener('click', rotateSelected);
        
        document.addEventListener('keydown', (e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElement) {
                deleteSelected();
            }
        });
    }

    function updateCssCourt(courtType) {
        const courtHalfLeft = document.getElementById('court-half-left');
        const courtHalfRight = document.getElementById('court-half-right');
        
        courtArea.classList.remove('hide-center-line');
        courtHalfLeft.style.display = 'block';
        courtHalfRight.style.display = 'block';
        courtHalfLeft.style.width = '50%';
        courtHalfRight.style.width = '50%';

        if (courtType === 'full') {
            courtHalfLeft.style.backgroundColor = 'var(--court-light-side)';
            courtHalfRight.style.backgroundColor = 'var(--court-dark-side)';
        } else if (courtType === 'offence') {
            courtHalfLeft.style.backgroundColor = 'var(--court-light-side)'; // Tai mikä vain "aktiivisen" puolen väri
            courtHalfRight.style.display = 'none';
            courtHalfLeft.style.width = '100%';
            courtArea.classList.add('hide-center-line');
        } else if (courtType === 'defence') {
            courtHalfRight.style.backgroundColor = 'var(--court-dark-side)'; // Tai mikä vain "aktiivisen" puolen väri
            courtHalfLeft.style.display = 'none';
            courtHalfRight.style.width = '100%';
            courtArea.classList.add('hide-center-line');
        }
    }

    function handleInteractionStart(e) {
        // Estä tekstin valinta raahauksen aikana, jos canvas on jonkin tekstielementin päällä
        if (e.target === canvas) e.preventDefault(); 
        
        const pos = getEventPosition(e);
        if (!pos) return;

        selectedElement = getElementAtPosition(pos.x, pos.y);

        if (selectedElement) {
            isMovingCanvasElement = true;
            dragOffsetX = pos.x - selectedElement.x;
            dragOffsetY = pos.y - selectedElement.y;
        } else {
            // Jos klikattiin tyhjää, poista valinta
            selectedElement = null;
        }
        draw();
    }

    function handleInteractionMove(e) {
        if (!isMovingCanvasElement || !selectedElement) return;
        if (e.target === canvas) e.preventDefault();
        const pos = getEventPosition(e);
        if (!pos) return;

        selectedElement.x = pos.x - dragOffsetX;
        selectedElement.y = pos.y - dragOffsetY;
        draw();
    }

    function handleInteractionEnd(e) {
        // Tapahtuu vaikka hiiri/sormi vapautetaan canvasin ulkopuolella
        if (isMovingCanvasElement && selectedElement) {
            saveState();
        }
        isMovingCanvasElement = false;
        // selectedElement jää valituksi
    }

    function getEventPosition(e) {
        const rect = canvas.getBoundingClientRect();
        let clientX, clientY;

        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else if (e.changedTouches && e.changedTouches.length > 0) { // For touchend
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        }
         else if (e.clientX !== undefined) {
            clientX = e.clientX;
            clientY = e.clientY;
        } else {
            return null;
        }
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }
    
    function createElementOnCanvas(data, x, y) {
        const dynamicArrowLength = Math.min(canvas.width * 0.1, 60); // Päivitä nuolen pituus
        const newElement = {
            id: Date.now() + Math.random().toString(36).substring(2, 9),
            type: data.type,
            x: x,
            y: y,
            rotation: 0,
            shape: data.shape,
            text: data.text,
            colorType: data.colorType,
            arrowType: data.arrowType,
            length: (data.type === 'arrow' ? dynamicArrowLength : undefined),
        };
        elements.push(newElement);
        selectedElement = newElement;
        saveState();
        draw();
    }

    function getElementAtPosition(x, y) {
        for (let i = elements.length - 1; i >= 0; i--) {
            const el = elements[i];
            const R = (el.type === 'player') ? PLAYER_RADIUS * 1.2 : (el.length || ARROW_DEFAULT_LENGTH) / 1.8; // Suurennetaan hieman osuma-aluetta
            
            // Käännetyn elementin osumatarkistus on monimutkaisempi.
            // Yksinkertaistettu etäisyys keskipisteestä:
            const dxEl = el.x;
            const dyEl = el.y;

            // Käännä tarkistuspiste (x,y) elementin koordinaatistoon
            const rotatedX = Math.cos(-el.rotation) * (x - dxEl) - Math.sin(-el.rotation) * (y - dyEl) + dxEl;
            const rotatedY = Math.sin(-el.rotation) * (x - dxEl) + Math.cos(-el.rotation) * (y - dyEl) + dyEl;
            
            const distSq = (rotatedX - dxEl) * (rotatedX - dxEl) + (rotatedY - dyEl) * (rotatedY - dyEl);

            if (distSq < R * R) {
                return el;
            }
        }
        return null;
    }

    function deleteSelected() {
        if (!selectedElement) return;
        elements = elements.filter(el => el.id !== selectedElement.id);
        selectedElement = null;
        saveState();
        draw();
    }

    function rotateSelected() {
        if (!selectedElement) return;
        selectedElement.rotation = (selectedElement.rotation || 0) + (Math.PI / 4);
        saveState();
        draw();
    }

    function saveState() {
        history.push(JSON.parse(JSON.stringify(elements)));
        if (history.length > MAX_HISTORY_STATES) {
            history.shift();
        }
    }

    function undo() {
        if (history.length <= 1) { // Jos vain alkuperäinen tyhjä tila tai ensimmäinen muutos
            if (elements.length > 0) { // Jos on elementtejä, tyhjennetään ne
                 elements = [];
                 selectedElement = null;
                 history = [JSON.parse(JSON.stringify(elements))]; // Tallenna tyhjä tila
                 draw();
            }
            return;
        }
        history.pop();
        elements = JSON.parse(JSON.stringify(history[history.length - 1]));
        selectedElement = null;
        draw();
    }

    function clearAll() {
        if (confirm("Haluatko varmasti tyhjentää kentän?")) {
            elements = [];
            selectedElement = null;
            history = [JSON.parse(JSON.stringify(elements))]; // Aloita historia uudelleen tyhjällä tilalla
            draw();
        }
    }

    function draw() {
        if (!ctx || canvas.width === 0 || canvas.height === 0) return; // Varmista, että canvas on valmis
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        elements.forEach(el => {
            ctx.save();
            ctx.translate(el.x, el.y);
            ctx.rotate(el.rotation);

            if (el.type === 'player') {
                drawPlayer(el);
            } else if (el.type === 'arrow') {
                drawArrow(el);
            }
            
            if (selectedElement && selectedElement.id === el.id) {
                drawSelection(el);
            }
            ctx.restore();
        });
    }
    
    function drawSelection(el) {
        ctx.strokeStyle = colors.selection;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const selectionPadding = 3;
        if (el.type === 'player') {
             ctx.arc(0, 0, PLAYER_RADIUS + selectionPadding, 0, Math.PI * 2);
        } else if (el.type === 'arrow') {
            const len = el.length || ARROW_DEFAULT_LENGTH;
            const halfLen = len / 2;
            const halfWidth = ARROW_HEAD_SIZE * 1.5; // Approximate width
            ctx.rect(-halfLen - selectionPadding, -halfWidth - selectionPadding, len + 2 * selectionPadding, halfWidth * 2 + 2 * selectionPadding);
        }
        ctx.stroke();
    }

    function drawPlayer(el) {
        const playerColor = (el.colorType === 'home') ? colors.home : colors.away;
        const textColor = (el.colorType === 'home') ? colors.textLight : colors.textDark;
        
        ctx.beginPath();
        ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = playerColor;
        ctx.fill();

        if (el.shape === 'X') {
            ctx.strokeStyle = textColor;
            ctx.lineWidth = 3;
            const d = PLAYER_RADIUS * 0.7;
            ctx.moveTo(-d, -d);
            ctx.lineTo(d, d);
            ctx.moveTo(d, -d);
            ctx.lineTo(-d, d);
            ctx.stroke();
        } else if (el.shape === 'number' && el.text) {
            ctx.fillStyle = textColor;
            ctx.font = `bold ${PLAYER_RADIUS * 1.2}px sans-serif`; // Skaalaa fonttikoko pelaajan koon mukaan
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(el.text, 0, 1); // Pieni y-offsetti voi auttaa keskityksessä
        }
    }

    function drawArrow(el) {
        ctx.strokeStyle = colors.arrow;
        ctx.fillStyle = colors.arrow;
        ctx.lineWidth = 3;

        const len = el.length || ARROW_DEFAULT_LENGTH; // Käytä tallennettua pituutta tai oletusta
        const startX = -len / 2;
        const endX = len / 2;

        ctx.beginPath();
        if (el.arrowType === 'dashed') {
            ctx.setLineDash([8, 6]);
        } else {
            ctx.setLineDash([]);
        }

        ctx.moveTo(startX, 0);

        switch (el.arrowType) {
            case 'straight':
            case 'dashed':
                ctx.lineTo(endX, 0);
                break;
            case 'arc':
                // Säädä kaaren jyrkkyyttä tarvittaessa
                ctx.quadraticCurveTo(0, -len / 2.5, endX, 0); 
                break;
            case 'zigzag':
                const segments = 4;
                const segmentLength = len / segments;
                const amplitude = PLAYER_RADIUS * 0.5; // Säädä amplitudia tarvittaessa
                ctx.moveTo(startX,0);
                for (let i = 0; i < segments; i++) {
                    const currentX = startX + i * segmentLength;
                    const nextX = startX + (i + 1) * segmentLength;
                    // Vaihda suuntaa joka toisella segmentillä
                    const currentY = (i % 2 === 0) ? -amplitude : amplitude;
                    // Viimeinen segmentti päättyy (endX, 0)
                    if (i === segments -1) {
                         ctx.lineTo(nextX, 0);
                    } else {
                         ctx.lineTo(nextX, currentY);
                    }
                }
                // Varmista, että loppupiste on oikea, jos zigzag on lyhyt
                if (segments === 0) ctx.lineTo(endX,0);
                break;
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Piirrä nuolenpää
        ctx.beginPath();
        ctx.moveTo(endX, 0);
        ctx.lineTo(endX - ARROW_HEAD_SIZE, -ARROW_HEAD_SIZE / 1.5); // Leveämpi pää
        ctx.lineTo(endX - ARROW_HEAD_SIZE, ARROW_HEAD_SIZE / 1.5);
        ctx.closePath();
        ctx.fill();
    }

    // Käynnistä sovellus
    init();
});
