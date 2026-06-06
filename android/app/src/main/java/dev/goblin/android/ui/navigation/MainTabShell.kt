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
import dev.goblin.android.domain.ResourceState
import dev.goblin.android.domain.ssh.RemoteRepositoryProfile

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainTabShell(
    selectedTab: MainTab,
    onSelectTab: (MainTab) -> Unit,
    onOpenSettings: () -> Unit,
    onAddHost: () -> Unit,
    onAddProject: () -> Unit,
    repositoriesState: ResourceState<List<RemoteRepositoryProfile>>,
    hostsContent: @Composable () -> Unit,
    projectsContent: @Composable () -> Unit,
) {
    val topBarTitle = when (selectedTab) {
        MainTab.Hosts -> "SSH Hosts"
        MainTab.Projects -> repositoriesState.projectScreenTitle()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(topBarTitle) },
                actions = {
                    TextButton(onClick = onOpenSettings) {
                        Text("Settings")
                    }
                    when (selectedTab) {
                        MainTab.Hosts -> TextButton(onClick = onAddHost) { Text("Add host") }
                        MainTab.Projects -> TextButton(onClick = onAddProject) { Text("Add project") }
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

private fun ResourceState<List<RemoteRepositoryProfile>>.projectScreenTitle(): String = when (this) {
    is ResourceState.Loaded -> "Projects"
    is ResourceState.Stale -> "Projects"
    is ResourceState.Error -> "Projects"
    ResourceState.Idle, ResourceState.Loading -> "Projects"
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
