# Aufgaben organisieren

Die Standardansicht zeigt das Board und die schnelle Aufgabenanlage. Backlog, Suche und Filter helfen beim Ordnen der Arbeit. Planung und Verwaltungsaktionen lassen sich bei Bedarf öffnen; für ein einfaches Board sind weder Epics noch Sprints oder Termine erforderlich.

## Aufgaben anlegen und bearbeiten

Auf dem Board einen Titel in „New ticket“ eingeben und mit „Create task“ oder Enter bestätigen. Weitere Angaben sind optional. Im Backlog sammelt „Add to Backlog“ Aufgaben, die noch nicht auf dem Board bearbeitet werden sollen. Mit „Add to board“ werden sie in die erste Board-Spalte übernommen.

Eine Karte per Klick oder mit Tab und Enter öffnen. Im Editor lassen sich Titel, Beschreibung, Status, Fälligkeit und Zuständigkeit ändern. „Planning and details“ enthält Typ, Dauer, Startdatum, Meilenstein, übergeordnete Aufgabe, Labels, Abhängigkeiten und Wiederholung. „Save“ speichert die Aufgabe. Ungespeicherte Änderungen lösen beim Schließen, Wechseln und Abmelden eine Rückfrage aus; „Cancel“ setzt die Bearbeitung fort.

Der Status kann im Editor oder durch Ziehen der Karte geändert werden. Offene Abhängigkeiten verhindern den Wechsel in die aktive Bearbeitung und in nachfolgende Spalten. Zum Abschließen die Aufgabe nach „Done“ verschieben.

## Checklisten und Filter

Mit „Add step“ Schritte zur Checkliste hinzufügen und einzelne Schritte abhaken. Änderungen mit „Save“ speichern. Die Karte zeigt die Zahl erledigter und vorhandener Schritte.

„My tasks“ zeigt Aufgaben des aktuellen Boards, die dem angemeldeten Konto zugewiesen sind. Die Suche berücksichtigt Titel und Beschreibung. Unter „Filters“ stehen Typ, Zuständigkeit, Abhängigkeiten und Labels zur Verfügung. „Reset filters“ setzt Suche und Filter zurück.

## Duplizieren, Archiv und Papierkorb

„Duplicate“ erstellt eine Kopie mit Beschreibung, Labels und Checkliste. Die Kopie beginnt in der ersten Spalte. Zuständigkeit, Termine, übergeordnete Aufgabe, Abhängigkeiten, Wiederholung und erledigte Checklistenpunkte werden zurückgesetzt.

„Archive“ entfernt eine Aufgabe aus der aktiven Arbeit. „Move to trash“ verschiebt sie in den Papierkorb. Beide Bereiche sind über „Board menu“ erreichbar. „Restore“ stellt eine Aufgabe mit ihren Kommentaren und ihrer Checkliste wieder her. Ihr bisheriger Status bleibt dabei erhalten.

## Kommentare, Aktivität und Benachrichtigungen

Kommentare werden mit „Comment“ veröffentlicht. Das Speichern einer Aufgabe veröffentlicht keinen Kommentarentwurf. Unter „Activity“ stehen Erstellung, Änderungen, Kommentare und Wiederherstellungen mit Benutzer und Zeitpunkt.

Eine Erwähnung wie `@benutzername` in einem Kommentar benachrichtigt den anderen Benutzer, wenn dieser auf das Board zugreifen darf. Auch eine neue Zuweisung durch einen anderen Benutzer erzeugt eine Benachrichtigung. Das Menü „Notifications“ aktualisiert sich bei geöffneter, sichtbarer Seite alle 30 Sekunden. Einzelne Nachrichten oder alle Nachrichten können als gelesen markiert werden. Es werden keine E-Mails verschickt.

## Wiederkehrende Aufgaben

Unter „Repeat after completion“ stehen Abstände von 1, 7 oder 30 Tagen zur Auswahl. Beim Wechsel nach „Done“ entsteht genau ein Nachfolger in der ersten Spalte, mit zurückgesetzter Checkliste und einem Fälligkeitstermin im gewählten Abstand zur Fertigstellung. Die Datumsberechnung verwendet das UTC-Datum.

Ein erneutes Öffnen und Abschließen der ursprünglichen Aufgabe erzeugt einen weiteren Nachfolger. Mehrfaches Speichern einer bereits erledigten Aufgabe erzeugt keinen weiteren. Ohne Abschluss werden keine Aufgaben automatisch nach Kalender angelegt.

## Planung und Datenaustausch

„Sprint planning“ lässt sich auf dem Board öffnen. Overview und Timeline sind unter „Planning“ erreichbar. Timeline kennzeichnet rechnerisch angenommene Termine als Schätzungen. Die vereinfachte Overview zeigt die wichtigsten fünf Spalten; „Show planning columns“ blendet zusätzliche Angaben ein.

„Export“ und „Import“ im Board-Menü übertragen ein Board als JSON. Der Import fügt Aufgaben zum ausgewählten Zielboard hinzu; wiederholter Import erzeugt weitere Kopien. Konten und Zugriffsrechte werden nicht übertragen, Zuständigkeiten werden zurückgesetzt.

Enthalten sind Aufgaben, Checklisten, Wiederholungen, Archiv- und Papierkorbstatus sowie Kommentare mit Zeitpunkt und Autorname. Importierte Autoren werden gekennzeichnet und keinem möglicherweise gleich nummerierten Konto der Zielinstallation zugeordnet. Aktivitätsprotokolle und Benachrichtigungen sind keine Bestandteile des Board-Exports.

Installation, Konfiguration und Architektur sind in der [README](../README.md) beschrieben.
