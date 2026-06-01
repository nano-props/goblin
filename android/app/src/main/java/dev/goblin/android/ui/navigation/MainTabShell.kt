package dev.goblin.android.ui.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.layout.layout
import androidx.compose.ui.zIndex

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainTabShell(
    selectedTab: MainTab,
    onSelectTab: (MainTab) -> Unit,
    onOpenSettings: () -> Unit,
    hostsContent: @Composable () -> Unit,
    projectsContent: @Composable () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(selectedTab.screenTitle) },
                actions = {
                    TextButton(onClick = onOpenSettings) {
                        Text("Settings")
                    }
                },
            )
        },
        bottomBar = {
            MainTabBar(
                selected = selectedTab,
                onSelect = onSelectTab,
            )
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            MainTabPane(
                visible = selectedTab == MainTab.Hosts,
                content = hostsContent,
            )
            MainTabPane(
                visible = selectedTab == MainTab.Projects,
                content = projectsContent,
            )
        }
    }
}

@Composable
private fun MainTabPane(
    visible: Boolean,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .zIndex(if (visible) 1f else 0f)
            .alpha(if (visible) 1f else 0f)
            .layout { measurable, constraints ->
                val placeable = measurable.measure(constraints)
                if (visible) {
                    layout(placeable.width, placeable.height) {
                        placeable.placeRelative(0, 0)
                    }
                } else {
                    layout(0, 0) {}
                }
            },
    ) {
        content()
    }
}

private val MainTab.screenTitle: String
    get() = when (this) {
        MainTab.Hosts -> "SSH Hosts"
        MainTab.Projects -> "Projects"
    }
