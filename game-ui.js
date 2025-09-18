// game/ui.js - User interface management for the rhythm game

import { config } from '../config.js';

export class GameUI {
    constructor() {
        // DOM elements
        this.scoreDisplay = document.getElementById('scoreDisplay');
        this.comboDisplay = document.getElementById('comboDisplay');
        this.healthFill = document.getElementById('healthFill');
        this.trackName = document.getElementById('trackName');
        this.trackArtist = document.getElementById('trackArtist');
        this.requiredThreshold = document.getElementById('requiredThreshold');
        this.resultsScreen = document.getElementById('resultsScreen');
        this.resultsStats = document.getElementById('resultsStats');
        this.completionCode = document.getElementById('completionCode');
        
        // Animation state
        this.lastScore = 0;
        this.lastCombo = 0;
        this.lastHealth = 100;
        this.animatingElements = new Set();
        
        // UI state
        this.currentTrackIndex = -1;
        this.isResultsShown = false;
        
        // Animation settings
        this.animationDuration = 300; // ms
        this.pulseAnimation = null;
        
        this.initializeElements();
    }

    /**
     * Initialize UI elements and set default states
     */
    initializeElements() {
        // Set initial values
        this.updateScore(0);
        this.updateCombo(0);
        this.updateHealth(100);
        this.updateTrackInfo('', '', 0);
        
        // Hide results screen initially
        if (this.resultsScreen) {
            this.resultsScreen.style.display = 'none';
        }
    }

    /**
     * Main update method called from game loop
     */
    update(gameState) {
        if (!gameState) return;
        
        // Update score with animation
        if (gameState.score !== this.lastScore) {
            this.updateScore(gameState.score);
            this.animateElement(this.scoreDisplay);
        }
        
        // Update combo with animation
        if (gameState.combo !== this.lastCombo) {
            this.updateCombo(gameState.combo);
            if (gameState.combo > this.lastCombo && gameState.combo > 0) {
                this.animateElement(this.comboDisplay, 'pulse');
            }
        }
        
        // Update health with smooth transition
        if (gameState.health !== this.lastHealth) {
            this.updateHealth(gameState.health);
        }
        
        // Update track info when track changes
        if (gameState.currentTrackIndex !== this.currentTrackIndex && gameState.currentTrack) {
            this.updateTrackInfo(
                gameState.currentTrack.name,
                gameState.currentTrack.artists?.[0]?.name || 'Unknown Artist',
                gameState.requiredPercent
            );
            this.currentTrackIndex = gameState.currentTrackIndex;
        }
        
        // Store last values
        this.lastScore = gameState.score;
        this.lastCombo = gameState.combo;
        this.lastHealth = gameState.health;
    }

    /**
     * Update score display with formatting
     */
    updateScore(score) {
        if (!this.scoreDisplay) return;
        
        // Format score with thousands separators
        const formattedScore = score.toLocaleString();
        this.scoreDisplay.textContent = formattedScore;
        
        // Add visual feedback for score increases
        if (score > this.lastScore && score > 0) {
            this.showScoreIncrease(score - this.lastScore);
        }
    }

    /**
     * Update combo display
     */
    updateCombo(combo) {
        if (!this.comboDisplay) return;
        
        if (combo > 0) {
            this.comboDisplay.textContent = `${combo}x`;
            this.comboDisplay.style.opacity = '1';
            
            // Change color based on combo level
            if (combo >= 100) {
                this.comboDisplay.style.color = '#ff00ff'; // Magenta for epic combos
            } else if (combo >= 50) {
                this.comboDisplay.style.color = '#ffff00'; // Yellow for great combos
            } else if (combo >= 25) {
                this.comboDisplay.style.color = '#00ff00'; // Green for good combos
            } else {
                this.comboDisplay.style.color = '#ffffff'; // White for normal combos
            }
        } else {
            this.comboDisplay.textContent = '';
            this.comboDisplay.style.opacity = '0.5';
            this.comboDisplay.style.color = '#ffffff';
        }
    }

    /**
     * Update health bar
     */
    updateHealth(health) {
        if (!this.healthFill) return;
        
        const percentage = Math.max(0, Math.min(100, health));
        this.healthFill.style.width = `${percentage}%`;
        
        // Change health bar color based on health level
        if (percentage <= 25) {
            this.healthFill.style.background = '#ff0000'; // Red - critical
        } else if (percentage <= 50) {
            this.healthFill.style.background = 'linear-gradient(90deg, #ff0000, #ff8000)'; // Red to orange
        } else if (percentage <= 75) {
            this.healthFill.style.background = 'linear-gradient(90deg, #ff8000, #ffff00)'; // Orange to yellow
        } else {
            this.healthFill.style.background = 'linear-gradient(90deg, #ffff00, #00ff00)'; // Yellow to green
        }
        
        // Add warning pulse for low health
        if (percentage <= 25 && !this.pulseAnimation) {
            this.startHealthWarning();
        } else if (percentage > 25 && this.pulseAnimation) {
            this.stopHealthWarning();
        }
    }

    /**
     * Update track information display
     */
    updateTrackInfo(trackName, artistName, requiredPercent) {
        if (this.trackName) {
            this.trackName.textContent = trackName || 'Loading...';
        }
        
        if (this.trackArtist) {
            this.trackArtist.textContent = artistName || '';
        }
        
        if (this.requiredThreshold) {
            if (requiredPercent > 0) {
                this.requiredThreshold.textContent = `Required: ${requiredPercent}%`;
                this.requiredThreshold.style.display = 'block';
            } else {
                this.requiredThreshold.style.display = 'none';
            }
        }
        
        // Animate track info change
        this.animateElement(this.trackName, 'slideIn');
    }

    /**
     * Show score increase animation
     */
    showScoreIncrease(scoreIncrease) {
        if (!this.scoreDisplay) return;
        
        // Create floating score popup
        const popup = document.createElement('div');
        popup.className = 'score-popup';
        popup.textContent = `+${scoreIncrease.toLocaleString()}`;
        popup.style.cssText = `
            position: absolute;
            top: ${this.scoreDisplay.offsetTop - 30}px;
            left: ${this.scoreDisplay.offsetLeft}px;
            color: #1db954;
            font-weight: bold;
            font-size: 18px;
            pointer-events: none;
            z-index: 1000;
            animation: scorePopup 1s ease-out forwards;
        `;
        
        // Add CSS animation if not already present
        if (!document.querySelector('#scorePopupStyle')) {
            const style = document.createElement('style');
            style.id = 'scorePopupStyle';
            style.textContent = `
                @keyframes scorePopup {
                    0% { transform: translateY(0) scale(1); opacity: 1; }
                    50% { transform: translateY(-20px) scale(1.2); opacity: 1; }
                    100% { transform: translateY(-40px) scale(0.8); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(popup);
        
        // Remove popup after animation
        setTimeout(() => {
            if (popup.parentNode) {
                popup.parentNode.removeChild(popup);
            }
        }, 1000);
    }

    /**
     * Animate UI element
     */
    animateElement(element, animationType = 'scale') {
        if (!element || this.animatingElements.has(element)) return;
        
        this.animatingElements.add(element);
        
        switch (animationType) {
            case 'scale':
                element.style.transform = 'scale(1.2)';
                element.style.transition = 'transform 0.15s ease-out';
                setTimeout(() => {
                    element.style.transform = 'scale(1)';
                    setTimeout(() => {
                        element.style.transition = '';
                        this.animatingElements.delete(element);
                    }, 150);
                }, 50);
                break;
                
            case 'pulse':
                element.style.transform = 'scale(1.3)';
                element.style.transition = 'transform 0.2s ease-out';
                element.style.filter = 'brightness(1.5)';
                setTimeout(() => {
                    element.style.transform = 'scale(1)';
                    element.style.filter = 'brightness(1)';
                    setTimeout(() => {
                        element.style.transition = '';
                        this.animatingElements.delete(element);
                    }, 200);
                }, 100);
                break;
                
            case 'slideIn':
                element.style.transform = 'translateX(-20px)';
                element.style.opacity = '0.5';
                element.style.transition = 'all 0.3s ease-out';
                setTimeout(() => {
                    element.style.transform = 'translateX(0)';
                    element.style.opacity = '1';
                    setTimeout(() => {
                        element.style.transition = '';
                        this.animatingElements.delete(element);
                    }, 300);
                }, 50);
                break;
        }
    }

    /**
     * Start health warning animation
     */
    startHealthWarning() {
        if (this.pulseAnimation) return;
        
        let intensity = 0;
        this.pulseAnimation = setInterval(() => {
            intensity += 0.1;
            const opacity = 0.3 + Math.sin(intensity) * 0.3;
            if (this.healthFill) {
                this.healthFill.style.opacity = opacity.toString();
            }
        }, 50);
    }

    /**
     * Stop health warning animation
     */
    stopHealthWarning() {
        if (this.pulseAnimation) {
            clearInterval(this.pulseAnimation);
            this.pulseAnimation = null;
            if (this.healthFill) {
                this.healthFill.style.opacity = '1';
            }
        }
    }

    /**
     * Show track completion popup
     */
    showTrackComplete(trackResult) {
        const popup = this.createPopup(
            trackResult.passed ? 'Track Complete!' : 'Track Failed',
            `${trackResult.trackName}\n${trackResult.playedPercent.toFixed(1)}% / ${trackResult.requiredPercent}% required\nAccuracy: ${trackResult.accuracy.toFixed(1)}%`,
            trackResult.passed ? '#00ff00' : '#ff4444',
            2000
        );
        
        // Add result-specific styling
        if (trackResult.passed) {
            popup.style.borderColor = '#00ff00';
        } else {
            popup.style.borderColor = '#ff4444';
        }
    }

    /**
     * Show session results screen
     */
    showResults(sessionResult) {
        if (!this.resultsScreen || !this.resultsStats || !this.completionCode) return;
        
        this.isResultsShown = true;
        
        // Hide game UI
        const gameContainer = document.getElementById('gameContainer');
        if (gameContainer) {
            gameContainer.style.display = 'none';
        }
        
        // Populate results
        this.populateResults(sessionResult);
        
        // Show results screen with animation
        this.resultsScreen.style.display = 'flex';
        this.resultsScreen.style.opacity = '0';
        this.resultsScreen.style.transform = 'translateY(50px)';
        
        setTimeout(() => {
            this.resultsScreen.style.transition = 'all 0.5s ease-out';
            this.resultsScreen.style.opacity = '1';
            this.resultsScreen.style.transform = 'translateY(0)';
        }, 50);
    }

    /**
     * Populate results screen with session data
     */
    populateResults(sessionResult) {
        // Set completion code
        this.completionCode.textContent = sessionResult.completionCode;
        
        // Clear existing results
        this.resultsStats.innerHTML = '';
        
        // Add overall session stats
        const overallDiv = document.createElement('div');
        overallDiv.className = 'track-result';
        overallDiv.innerHTML = `
            <div class="track-result-name" style="font-size: 16px; color: #1db954;">
                Session Summary
            </div>
            <div class="track-result-score">
                <div>Total Score: ${sessionResult.totalScore.toLocaleString()}</div>
                <div>Max Combo: ${sessionResult.totalMaxCombo}x</div>
                <div>Accuracy: ${sessionResult.overallAccuracy.toFixed(1)}%</div>
            </div>
        `;
        this.resultsStats.appendChild(overallDiv);
        
        // Add separator
        const separator = document.createElement('div');
        separator.style.cssText = 'height: 1px; background: rgba(255,255,255,0.2); margin: 15px 0;';
        this.resultsStats.appendChild(separator);
        
        // Add individual track results
        sessionResult.trackResults.forEach((trackResult, index) => {
            const trackDiv = document.createElement('div');
            trackDiv.className = 'track-result';
            
            const passIcon = trackResult.passed ? '✅' : '❌';
            const passColor = trackResult.passed ? '#00ff00' : '#ff4444';
            
            trackDiv.innerHTML = `
                <div class="track-result-name">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span>${passIcon}</span>
                        <div>
                            <div style="font-weight: bold;">${trackResult.trackName}</div>
                            <div style="font-size: 12px; opacity: 0.7;">${trackResult.artistName}</div>
                        </div>
                    </div>
                </div>
                <div class="track-result-score">
                    <div style="color: ${passColor};">
                        ${trackResult.playedPercent.toFixed(1)}% / ${trackResult.requiredPercent}%
                    </div>
                    <div style="font-size: 11px;">
                        Accuracy: ${trackResult.accuracy.toFixed(1)}%
                    </div>
                    <div style="font-size: 11px;">
                        Max Combo: ${trackResult.maxCombo}x
                    </div>
                </div>
            `;
            
            this.resultsStats.appendChild(trackDiv);
        });
        
        // Add detailed hit stats
        const hitStatsDiv = document.createElement('div');
        hitStatsDiv.className = 'track-result';
        hitStatsDiv.style.marginTop = '15px';
        hitStatsDiv.innerHTML = `
            <div class="track-result-name" style="font-size: 14px; color: #1db954;">
                Hit Statistics
            </div>
            <div class="track-result-score" style="font-size: 12px;">
                <div style="color: #00ff00;">Perfect: ${sessionResult.sessionStats.perfect}</div>
                <div style="color: #ffff00;">Great: ${sessionResult.sessionStats.great}</div>
                <div style="color: #ff8000;">Good: ${sessionResult.sessionStats.good}</div>
                <div style="color: #ff4444;">Miss: ${sessionResult.sessionStats.miss}</div>
            </div>
        `;
        this.resultsStats.appendChild(hitStatsDiv);
    }

    /**
     * Create a temporary popup message
     */
    createPopup(title, message, color = '#ffffff', duration = 3000) {
        const popup = document.createElement('div');
        popup.className = 'game-popup';
        popup.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.9);
            color: ${color};
            padding: 20px 30px;
            border-radius: 10px;
            border: 2px solid ${color};
            text-align: center;
            z-index: 2000;
            font-size: 18px;
            font-weight: bold;
            max-width: 90%;
            animation: popupFade ${duration}ms ease-in-out;
        `;
        
        const titleEl = document.createElement('div');
        titleEl.textContent = title;
        titleEl.style.cssText = 'font-size: 24px; margin-bottom: 10px;';
        popup.appendChild(titleEl);
        
        if (message) {
            const messageEl = document.createElement('div');
            messageEl.textContent = message;
            messageEl.style.cssText = 'font-size: 14px; opacity: 0.8; white-space: pre-line;';
            popup.appendChild(messageEl);
        }
        
        // Add CSS animation if not present
        if (!document.querySelector('#popupFadeStyle')) {
            const style = document.createElement('style');
            style.id = 'popupFadeStyle';
            style.textContent = `
                @keyframes popupFade {
                    0%, 15% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
                    20%, 80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                    100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(popup);
        
        // Remove popup after duration
        setTimeout(() => {
            if (popup.parentNode) {
                popup.parentNode.removeChild(popup);
            }
        }, duration);
        
        return popup;
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info', duration = 3000) {
        const colors = {
            info: '#1db954',
            warning: '#ffaa00',
            error: '#ff4444',
            success: '#00ff00'
        };
        
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.9);
            color: ${colors[type] || colors.info};
            padding: 12px 24px;
            border-radius: 25px;
            font-size: 14px;
            z-index: 1001;
            animation: toastFade ${duration}ms ease-in-out;
            max-width: 80%;
            text-align: center;
        `;
        
        // Add CSS if not present
        if (!document.querySelector('#toastFadeStyle')) {
            const style = document.createElement('style');
            style.id = 'toastFadeStyle';
            style.textContent = `
                @keyframes toastFade {
                    0%, 10% { opacity: 0; transform: translateX(-50%) translateY(20px); }
                    15%, 85% { opacity: 1; transform: translateX(-50%) translateY(0); }
                    100% { opacity: 0; transform: translateX(-50%) translateY(20px); }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, duration);
        
        return toast;
    }

    /**
     * Hide results screen and return to game/menu
     */
    hideResults() {
        if (this.resultsScreen) {
            this.resultsScreen.style.display = 'none';
        }
        
        const gameContainer = document.getElementById('gameContainer');
        if (gameContainer) {
            gameContainer.style.display = 'block';
        }
        
        this.isResultsShown = false;
    }

    /**
     * Reset UI to initial state
     */
    reset() {
        this.updateScore(0);
        this.updateCombo(0);
        this.updateHealth(100);
        this.updateTrackInfo('', '', 0);
        
        this.lastScore = 0;
        this.lastCombo = 0;
        this.lastHealth = 100;
        this.currentTrackIndex = -1;
        
        this.stopHealthWarning();
        this.hideResults();
        
        // Clear any active animations
        this.animatingElements.clear();
        
        console.log('UI reset');
    }

    /**
     * Get UI state for debugging
     */
    getUIState() {
        return {
            score: this.lastScore,
            combo: this.lastCombo,
            health: this.lastHealth,
            trackIndex: this.currentTrackIndex,
            resultsShown: this.isResultsShown,
            animatingElements: this.animatingElements.size,
            healthWarning: !!this.pulseAnimation
        };
    }
}