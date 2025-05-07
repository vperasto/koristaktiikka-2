document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('strategy-canvas');
    const ctx = canvas.getContext('2d');
    const courtArea = document.getElementById('court-area');
    const sidebar = document.getElementById('sidebar');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    const mainContent = document.getElementById('main-content'); // Lisätty

    let elements = [];
    let selectedElement = null;
    let history = [];
    const MAX_HISTORY_STATES = 20;

    // --- Tool and Drawing State ---
    let currentTool = 'select'; // Oletustyökalu on valinta/siirto
    let currentArrowType = null; // Esim. 'straight', 'dashed'
    let isDrawing = false; // Yleinen lippu piirtämiselle (esim. nuoli)
    let startPoint = null; // Nuolen tai muun piirrettävän elementin aloituspiste
    let previewElement = null; // Elementti, jota esikatsellaan piirron aikana

    // Dragging state for existing elements
    let isMovingCanvasElement = false;
    let dragOffsetX, dragOffsetY;

    // Dragging from palette (pelaajat)
    let isDraggingPaletteElement = false;

    const colors = {
        home: '#EF4444', away: '#22D3EE', arrow: '#EC4899',
        textLight: '#F8FAFC', textDark: '#0F172A', selection: '#F97316'
    };

    const PLAYER_RADIUS = 15;
    const ARROW_DEFAULT_LENGTH = 60; // Tätä käytetään nyt vain, jos nuoli luodaan ilman loppupistettä
    const ARROW_HEAD_SIZE = 10; // Hieman isompi nuolenpää

    function init() {
        window.addEventListener('resize', resizeCanvasAndDraw);
        resizeCanvasAndDraw();
        setupEventListeners();
        saveState();
        setActiveTool('select'); // Aseta valintatyökalu aktiiviseksi alussa
        updateCssCourt(document.querySelector('.court-select-btn.active').dataset.courtType);
        draw();
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
            mainContent.classList.toggle('sidebar-visible', !sidebar.classList.contains('hidden'));
             // Säädä napin sijaintia, jos sivupalkki on piilossa/näkyvissä
            if (sidebar.classList.contains('hidden')) {
                toggleSidebarBtn.style.left = '15px';
            } else {
                // Jos haluat napin siirtyvän sivupalkin reunaan:
                // toggleSidebarBtn.style.left = `${sidebar.offsetWidth + 15}px`;
                // Tai pidä se paikallaan:
                toggleSidebarBtn.style.left = '15px'; 
            }
            setTimeout(resizeCanvasAndDraw, 310); 
        });
        // Alkuasetus pääsisällön marginaalille
        mainContent.classList.toggle('sidebar-visible', !sidebar.classList.contains('hidden'));
         if (!sidebar.classList.contains('hidden')) {
            // toggleSidebarBtn.style.left = `${sidebar.offsetWidth + 15}px`;
         }


        document.querySelectorAll('.court-select-btn').forEach(button => {
            button.addEventListener('click', () => {
                document.querySelectorAll('.court-select-btn').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                updateCssCourt(button.dataset.courtType);
                resizeCanvasAndDraw(); 
            });
        });
        
        // --- Tool Selector Buttons ---
        document.querySelectorAll('.tool-selector').forEach(button => {
            button.addEventListener('click', () => {
                const tool = button.dataset.tool;
                setActiveTool(tool, button.dataset); // Välitä kaikki data-attribuutit
            });
        });

        // --- Palette Element Drag (Pelaajat) ---
        document.querySelectorAll('.element-btn.draggable').forEach(button => {
            button.addEventListener('dragstart', (e) => {
                // Varmista, että valintatyökalu on aktiivinen, jotta drag & drop toimii odotetusti
                // Tai salli drag&drop riippumatta työkalusta, jos se on pelaaja
                // Tässä oletetaan, että pelaajan voi aina vetää
                isDraggingPaletteElement = true;
                const data = { ...button.dataset };
                e.dataTransfer.setData('application/json', JSON.stringify(data));
                e.dataTransfer.effectAllowed = 'copy';
            });
            button.addEventListener('dragend', () => {
                isDraggingPaletteElement = false;
            });
        });

        canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!isDraggingPaletteElement) return; // Salli drop vain paletista vedettäessä

            const jsonData = e.dataTransfer.getData('application/json');
            if (!jsonData) return;

            const data = JSON.parse(jsonData);
            if (data.tool !== 'player') return; // Salli vain pelaajien drop

            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            createElementOnCanvas(data, x, y);
            isDraggingPaletteElement = false;
            setActiveTool('select'); // Palaa valintatyökaluun pelaajan lisäämisen jälkeen
        });
        
        // --- Canvas Interactions ---
        canvas.addEventListener('mousedown', handleInteractionStart);
        canvas.addEventListener('touchstart', handleInteractionStart, { passive: false });
        canvas.addEventListener('mousemove', handleInteractionMove);
        canvas.addEventListener('touchmove', handleInteractionMove, { passive: false });
        document.addEventListener('mouseup', handleInteractionEnd); 
        document.addEventListener('touchend', handleInteractionEnd);

        // --- Action Buttons ---
        document.getElementById('undo-btn').addEventListener('click', undo);
        document.getElementById('clear-btn').addEventListener('click', clearAll);
        document.getElementById('delete-selected-btn').addEventListener('click', deleteSelected);
        document.getElementById('rotate-selected-btn').addEventListener('click', rotateSelected);
        
        document.addEventListener('keydown', (e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElement && currentTool === 'select') {
                deleteSelected();
            }
            if (e.key === 'Escape') { // Esc lopettaa piirtämisen ja palaa valintatyökaluun
                if (isDrawing) {
                    isDrawing = false;
                    previewElement = null;
                    draw();
                }
                setActiveTool('select');
            }
        });
    }

    function setActiveTool(toolName, toolData = {}) {
        currentTool = toolName;
        selectedElement = null; // Poista valinta työkalua vaihdettaessa
        isDrawing = false; // Nollaa piirtotila
        previewElement = null; // Nollaa esikatselu

        // Päivitä nappien ulkoasu
        document.querySelectorAll('.tool-selector').forEach(btn => btn.classList.remove('active'));
        const activeButton = document.querySelector(`.tool-selector[data-tool="${toolName}"]` + (toolName === 'arrow' ? `[data-arrow-type="${toolData.arrowType}"]` : ''));
        if (activeButton) {
            activeButton.classList.add('active');
        } else if (toolName === 'select') { // Varmista, että "Valitse" nappi aktivoituu
            document.getElementById('select-tool-btn')?.classList.add('active');
        }


        if (toolName === 'arrow') {
            currentArrowType = toolData.arrowType;
            canvas.style.cursor = 'crosshair';
        } else if (toolName === 'player' && toolData.draggable !== "true") { // Jos pelaaja lisätään klikkaamalla (ei toteutettu)
            canvas.style.cursor = 'copy';
        }
         else { // select tool tai muu
            canvas.style.cursor = 'default';
            currentArrowType = null;
        }
        draw(); // Päivitä näyttö (esim. poista valinnan korostus)
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
            courtHalfLeft.style.backgroundColor = 'var(--court-light-side)';
            courtHalfRight.style.display = 'none';
            courtHalfLeft.style.width = '100%';
            courtArea.classList.add('hide-center-line');
        } else if (courtType === 'defence') {
            courtHalfRight.style.backgroundColor = 'var(--court-dark-side)';
            courtHalfLeft.style.display = 'none';
            courtHalfRight.style.width = '100%';
            courtArea.classList.add('hide-center-line');
        }
    }

    function handleInteractionStart(e) {
        if (e.target === canvas) e.preventDefault(); 
        const pos = getEventPosition(e);
        if (!pos) return;

        if (currentTool === 'arrow' && currentArrowType) {
            isDrawing = true;
            startPoint = pos;
            previewElement = { // Alustava esikatseluelementti
                type: 'arrow',
                arrowType: currentArrowType,
                x: startPoint.x, // Aluksi keskipiste on aloituspiste
                y: startPoint.y,
                length: 0,
                rotation: 0
            };
        } else if (currentTool === 'select') {
            selectedElement = getElementAtPosition(pos.x, pos.y);
            if (selectedElement) {
                isMovingCanvasElement = true;
                dragOffsetX = pos.x - selectedElement.x;
                dragOffsetY = pos.y - selectedElement.y;
            }
        }
        draw();
    }

    function handleInteractionMove(e) {
        if (e.target === canvas) e.preventDefault();
        const pos = getEventPosition(e);
        if (!pos) return;

        if (isDrawing && currentTool === 'arrow' && startPoint) {
            const dx = pos.x - startPoint.x;
            const dy = pos.y - startPoint.y;
            previewElement.length = Math.sqrt(dx * dx + dy * dy);
            previewElement.rotation = Math.atan2(dy, dx);
            // Nuolen keskipiste on piirtosuunnan keskellä
            previewElement.x = startPoint.x + dx / 2;
            previewElement.y = startPoint.y + dy / 2;
            draw();
        } else if (isMovingCanvasElement && selectedElement && currentTool === 'select') {
            selectedElement.x = pos.x - dragOffsetX;
            selectedElement.y = pos.y - dragOffsetY;
            draw();
        }
    }

    function handleInteractionEnd(e) {
        const pos = getEventPosition(e); // Tarvitaan, jos hiiri vapautetaan canvasin ulkopuolella

        if (isDrawing && currentTool === 'arrow' && startPoint && previewElement && previewElement.length > ARROW_HEAD_SIZE * 2) { // Vain jos nuoli on tarpeeksi pitkä
            // Luo pysyvä nuoli esikatselun perusteella
            const finalArrow = { ...previewElement, id: Date.now() + Math.random().toString(36).substring(2, 9) };
            elements.push(finalArrow);
            selectedElement = finalArrow; // Valitse uusi nuoli
            saveState();
            // setActiveTool('select'); // Kommentoitu pois, jotta voi piirtää useita nuolia peräkkäin
        }
        
        isDrawing = false;
        startPoint = null;
        previewElement = null;
        
        if (isMovingCanvasElement && selectedElement) {
            saveState(); // Tallenna tila vasta kun siirto on valmis
        }
        isMovingCanvasElement = false;
        
        // Jos ei piirretty mitään merkittävää nuolta, eikä siirretty, ja klikattiin tyhjään, poista valinta.
        if (currentTool === 'select' && !selectedElement && pos && !getElementAtPosition(pos.x, pos.y)) {
             // Tämä ehto voi olla monimutkainen, jos halutaan tarkka "klikkaus tyhjään"
        }

        draw();
    }

    function getEventPosition(e) {
        const rect = canvas.getBoundingClientRect();
        let clientX, clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX; clientY = e.touches[0].clientY;
        } else if (e.changedTouches && e.changedTouches.length > 0) {
            clientX = e.changedTouches[0].clientX; clientY = e.changedTouches[0].clientY;
        } else if (e.clientX !== undefined) {
            clientX = e.clientX; clientY = e.clientY;
        } else { return null; }
        return { x: clientX - rect.left, y: clientY - rect.top };
    }
    
    function createElementOnCanvas(data, x, y) { // Käytetään nyt vain pelaajille (drag & drop)
        const newElement = {
            id: Date.now() + Math.random().toString(36).substring(2, 9),
            type: data.type, x: x, y: y, rotation: 0,
            shape: data.shape, text: data.text, colorType: data.colorType
        };
        elements.push(newElement);
        selectedElement = newElement;
        saveState();
        draw();
    }

    function getElementAtPosition(x, y) {
        for (let i = elements.length - 1; i >= 0; i--) {
            const el = elements[i];
            const R = (el.type === 'player') ? PLAYER_RADIUS * 1.2 : (el.length || ARROW_DEFAULT_LENGTH) / 1.8;
            const dxEl = el.x; const dyEl = el.y;
            const rotatedX = Math.cos(-el.rotation) * (x - dxEl) - Math.sin(-el.rotation) * (y - dyEl) + dxEl;
            const rotatedY = Math.sin(-el.rotation) * (x - dxEl) + Math.cos(-el.rotation) * (y - dyEl) + dyEl;
            const distSq = (rotatedX - dxEl) * (rotatedX - dxEl) + (rotatedY - dyEl) * (rotatedY - dyEl);
            if (distSq < R * R) return el;
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
        if (history.length > MAX_HISTORY_STATES) history.shift();
    }

    function undo() {
        if (history.length <= 1) {
            if (elements.length > 0) {
                 elements = []; selectedElement = null;
                 history = [JSON.parse(JSON.stringify(elements))];
                 draw();
            } return;
        }
        history.pop();
        elements = JSON.parse(JSON.stringify(history[history.length - 1]));
        selectedElement = null; draw();
    }

    function clearAll() {
        if (confirm("Haluatko varmasti tyhjentää kentän?")) {
            elements = []; selectedElement = null;
            history = [JSON.parse(JSON.stringify(elements))]; draw();
        }
    }

    function draw() {
        if (!ctx || canvas.width === 0 || canvas.height === 0) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        elements.forEach(el => drawElement(el));
        
        // Piirrä esikatselunuoli, jos piirtämässä
        if (isDrawing && previewElement && currentTool === 'arrow') {
            drawElement(previewElement, true); // true merkkaa, että on esikatselu
        }
        
        // Piirrä valitun elementin korostus, jos valintatyökalu on aktiivinen
        if (selectedElement && currentTool === 'select') {
            ctx.save();
            ctx.translate(selectedElement.x, selectedElement.y);
            ctx.rotate(selectedElement.rotation);
            drawSelection(selectedElement);
            ctx.restore();
        }
    }
    
    function drawElement(el, isPreview = false) {
        ctx.save();
        ctx.translate(el.x, el.y);
        ctx.rotate(el.rotation);

        if (isPreview && el.type === 'arrow') {
            ctx.globalAlpha = 0.5; // Tee esikatselusta hieman läpikuultava
        }

        if (el.type === 'player') {
            drawPlayer(el);
        } else if (el.type === 'arrow') {
            drawArrow(el);
        }
        
        ctx.globalAlpha = 1.0; // Palauta normaali alpha
        ctx.restore();
    }

    function drawSelection(el) { // Tämä kutsutaan jo transformoidussa kontekstissa
        ctx.strokeStyle = colors.selection;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const selectionPadding = 3;
        if (el.type === 'player') {
             ctx.arc(0, 0, PLAYER_RADIUS + selectionPadding, 0, Math.PI * 2);
        } else if (el.type === 'arrow') {
            const len = el.length || ARROW_DEFAULT_LENGTH;
            const halfLen = len / 2;
            // Nuolen valintakehys voisi olla yksinkertainen suorakulmio sen pituuden ja pienen leveyden mukaan
            const arrowHitWidth = ARROW_HEAD_SIZE * 2; // Leveys osumatarkistukselle
            ctx.rect(-halfLen - selectionPadding, -arrowHitWidth/2 - selectionPadding, len + 2 * selectionPadding, arrowHitWidth + 2 * selectionPadding);
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
            ctx.strokeStyle = textColor; ctx.lineWidth = 3; const d = PLAYER_RADIUS * 0.7;
            ctx.moveTo(-d, -d); ctx.lineTo(d, d); ctx.moveTo(d, -d); ctx.lineTo(-d, d); ctx.stroke();
        } else if (el.shape === 'number' && el.text) {
            ctx.fillStyle = textColor; ctx.font = `bold ${PLAYER_RADIUS * 1.2}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(el.text, 0, 1);
        }
    }

    function drawArrow(el) {
        ctx.strokeStyle = colors.arrow;
        ctx.fillStyle = colors.arrow;
        ctx.lineWidth = 3;

        const len = el.length || ARROW_DEFAULT_LENGTH; 
        const startX = -len / 2; // Nuoli piirretään keskipisteensä ympärille
        const endX = len / 2;

        ctx.beginPath();
        if (el.arrowType === 'dashed') ctx.setLineDash([8, 6]);
        else ctx.setLineDash([]);
        
        ctx.moveTo(startX, 0);

        // Kaari ja Zigzag vaativat erilaista käsittelyä, jos pituus/rotaatio määrittää ne
        // Tässä toteutuksessa ne ovat suoria, mutta eri viivatyylillä tai muodolla
        if (el.arrowType === 'arc') { // Yksinkertainen symmetrinen kaari
             // Kontrollipiste nuolen keskellä, kohtisuorassa nuolen suuntaan
            // Tämän voisi tehdä monimutkaisemmaksi, esim. antaa käyttäjän säätää kaarevuutta
            // Tässä vaiheessa kaari on vain hieman kaareva viiva.
            // Piirretään suorana, mutta voidaan myöhemmin muuttaa, kun kaaren piirto toteutetaan.
            // ctx.quadraticCurveTo(0, -len * 0.2, endX, 0); // Pieni kaari
            ctx.lineTo(endX, 0); // Tällä hetkellä kaari piirretään suorana
        } else if (el.arrowType === 'zigzag') { // Yksinkertainen zigzag
            // Piirretään suorana, voidaan myöhemmin muuttaa
            ctx.lineTo(endX, 0);
        }
        else { // straight, dashed
            ctx.lineTo(endX, 0);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Piirrä nuolenpää (aina nuolen "loppupäässä" eli endX)
        ctx.beginPath();
        ctx.moveTo(endX, 0);
        ctx.lineTo(endX - ARROW_HEAD_SIZE, -ARROW_HEAD_SIZE / 2); // Kapeampi pää
        ctx.lineTo(endX - ARROW_HEAD_SIZE, ARROW_HEAD_SIZE / 2);
        ctx.closePath();
        ctx.fill();
    }
    init();
});
